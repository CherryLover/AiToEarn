#!/usr/bin/env bash
#
# 在 OCI 服务器上应用一次部署。不构建任何镜像：镜像由 GitHub Actions「Fork Images」构建好推到 ghcr.io。
#
#   /opt/stack/aitoearn/repo/deploy/oci/deploy.sh [镜像标签] [--ref <git 引用>]
#
# 做的事：
#   1. 仓库副本 repo/ 切到指定 git 引用（默认 origin/main），拿到最新的部署文件和官方配置模板
#   2. 定版本：给了镜像标签就用它，没给就取 main 上构建出来的最新版本，写回 .env
#   3. 用 .env 渲染 config/server.yaml、config/ai.yaml
#   4. 建数据目录（含运行时配置覆盖层的空文件），拉镜像，docker compose up -d，等健康检查
#
set -euo pipefail

STACK_DIR=/opt/stack/aitoearn
COMPOSE=(docker compose --project-directory "$STACK_DIR" --env-file "$STACK_DIR/.env" -f "$STACK_DIR/repo/deploy/oci/docker-compose.yml")

TAG=""
REF="origin/main"
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    *) TAG="$1"; shift ;;
  esac
done

cd "$STACK_DIR"
[ -f .env ] || { echo "✗ 缺少 $STACK_DIR/.env，照 repo/deploy/oci/.env.example 填好" >&2; exit 1; }

# 不给标签时自动取的是 main 的最新构建（`:latest` 只有 main 会打），
# 所以在别的引用上部署必须显式给标签。放在同步 repo/ 之前拦：拦下来时部署文件还没被切走
if [ -z "$TAG" ]; then
  case "$REF" in
    main | origin/main | refs/heads/main) ;;
    *)
      echo "✗ 在 $REF 上部署必须显式给镜像标签" >&2
      echo "  :latest 指的是 main，自动取版本会把 $REF 的部署文件配上 main 的镜像" >&2
      exit 1
      ;;
  esac
fi

# 同步会改写本脚本自身，bash 边读边执行会读到新旧混合的内容，所以同步完立刻用新版重跑一次
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  echo "==> 同步部署文件（$REF）"
  git -C repo fetch --quiet origin
  git -C repo checkout --quiet --detach "$REF"
  git -C repo log -1 --format='    %h %s'
  export DEPLOY_REEXEC=1
  exec "$STACK_DIR/repo/deploy/oci/deploy.sh" ${TAG:+"$TAG"} --ref "$REF"
fi

# 镜像是公开的，匿名要个只读 token 就能查 ghcr
GHCR_ACCEPT='application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.list.v2+json'

ghcr_token() {
  curl -fsS "https://ghcr.io/token?scope=repository:cherrylover/$1:pull" | sed -E 's/.*"token":"([^"]+)".*/\1/'
}

# 某个标签指向哪个 manifest；标签不存在就是空
manifest_digest() {
  curl -fsS -o /dev/null -D - "https://ghcr.io/v2/cherrylover/$1/manifests/$2" \
      -H "Accept: $GHCR_ACCEPT" -H "Authorization: Bearer $3" 2>/dev/null \
    | tr -d '\r' | awk -F': ' 'tolower($1) == "docker-content-digest" { print $2 }'
}

image_has_tag() {
  local token
  token=$(ghcr_token "$1") || return 1
  [ -n "$(manifest_digest "$1" "$2" "$token")" ]
}

# main 上最新那次构建的版本号标签。
#
# `:latest` 只有 main 会打（见 fork-images.yml），所以它就是「main 的最新」。但 .env 里不写 latest：
# 写死版本号，`docker compose ps` 和日志里才看得出线上到底跑的哪一版，隔几天原样再跑一次 deploy.sh
# 也还是同一版，而不是悄悄又升一级。所以这里反查出和 `:latest` 同一个 manifest 的那个版本号标签。
latest_main_tag() {
  local repo="$1" token digest tag
  token=$(ghcr_token "$repo") || return 1
  digest=$(manifest_digest "$repo" latest "$token")
  [ -n "$digest" ] || return 1
  # 标签表是按字典序返回的，版本号是「日期-提交号」，倒序就是从新到旧。
  # 真正认数的是 manifest 比对，顺序只决定要问几次。n=1000 没跟 Link 分页，
  # 哪天标签真超过一千个，这里会查不到，落到调用处「沿用 .env 里的旧值」那条路
  for tag in $(curl -fsS "https://ghcr.io/v2/cherrylover/$repo/tags/list?n=1000" \
                 -H "Authorization: Bearer $token" \
               | tr ',' '\n' | grep -oE '[0-9]{8}-[0-9a-f]{8}' | sort -ru); do
    if [ "$(manifest_digest "$repo" "$tag" "$token")" = "$digest" ]; then
      echo "$tag"
      return 0
    fi
  done
  return 1
}

IMAGES=("aitoearn-server:SERVER_TAG" "aitoearn-ai:AI_TAG" "aitoearn-web:WEB_TAG")

if [ -n "$TAG" ]; then
  echo "==> 镜像标签 $TAG"
  for pair in "${IMAGES[@]}"; do
    repo="${pair%%:*}"; var="${pair##*:}"
    if image_has_tag "$repo" "$TAG"; then
      sed -i "s/^$var=.*/$var=$TAG/" .env
      echo "    $repo -> $TAG"
    else
      echo "    $repo 没有这个版本，沿用 $(grep -E "^$var=" .env | cut -d= -f2)"
    fi
  done
else
  # 不给标签 = 用 main 上构建出来的最新版本。
  # 三个镜像各查各的：只改了后台的那次推送不会重建网页镜像，网页就该停在它自己最后一次构建上
  echo "==> 没给标签，取 main 上最新构建"
  for pair in "${IMAGES[@]}"; do
    repo="${pair%%:*}"; var="${pair##*:}"
    if resolved=$(latest_main_tag "$repo"); then
      sed -i "s/^$var=.*/$var=$resolved/" .env
      echo "    $repo -> $resolved"
    else
      echo "    $repo 查不到 main 的最新构建，沿用 $(grep -E "^$var=" .env | cut -d= -f2)"
    fi
  done
fi

set -a; . ./.env; set +a
for var in SERVER_TAG AI_TAG WEB_TAG; do
  [ -n "$(eval echo \$$var)" ] || { echo "✗ .env 里 $var 为空" >&2; exit 1; }
done

echo "==> 渲染配置"
mkdir -p config
BACKEND=repo/project/aitoearn-backend/apps
python3 repo/deploy/oci/render_config.py "$BACKEND/aitoearn-server/config/config.yaml" repo/deploy/oci/overrides/server.yaml config/server.yaml
python3 repo/deploy/oci/render_config.py "$BACKEND/aitoearn-ai/config/config.yaml" repo/deploy/oci/overrides/ai.yaml config/ai.yaml

echo "==> 数据目录 $DATA_DIR"
sudo mkdir -p "$DATA_DIR"/{mongodb/db,mongodb/configdb,redis,rustfs,projects,config}
# 运行时配置覆盖层：网页 /config 保存的那份，deploy.sh 只负责把空文件建出来，之后再也不碰它，
# 所以重新部署不会冲掉线上改过的值。必须在 docker compose 之前建好：
# Docker 对不存在的宿主机挂载源会直接建成目录，那样后端就永远读不到这份配置了。
# 里面会有上游 Key，权限锁 600
for f in server.override.yaml ai.override.yaml; do
  sudo touch "$DATA_DIR/config/$f"
  sudo chmod 600 "$DATA_DIR/config/$f"
done
# rustfs 镜像以 uid 10001 运行，数据目录要归它，否则启动报 Permission denied
sudo chown 10001:10001 "$DATA_DIR/rustfs"
# projects 不改属主：aitoearn-server / aitoearn-ai 两个 Dockerfile 都没写 USER，容器内进程就是 root(uid 0)，
# sudo mkdir 建出来的 root:root 目录它们本来就能读写。哪天镜像加了 USER，这里要跟着 chown 成对应 uid

echo "==> 拉镜像并启动（server=$SERVER_TAG ai=$AI_TAG web=$WEB_TAG）"
"${COMPOSE[@]}" pull --quiet
# 基础服务：配置没变就不动
"${COMPOSE[@]}" up -d --remove-orphans mongodb mongodb-rs-init redis rustfs rustfs-init
# 应用服务每次都先删再建：配置和 nginx.conf 是单文件挂载，重新生成/切换 git 版本会换掉文件，
# 不重建的话容器里看到的还是旧文件。不用 --force-recreate：旧容器不健康时 compose 会先卡在依赖检查上
APPS=(aitoearn-ai aitoearn-server aitoearn-web nginx)
"${COMPOSE[@]}" rm --stop --force "${APPS[@]}"
"${COMPOSE[@]}" up -d "${APPS[@]}"

echo "==> 等健康检查"
for i in $(seq 1 60); do
  unhealthy=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$2 != "" && $2 != "healthy"' || true)
  [ -z "$unhealthy" ] && break
  sleep 5
done
"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
if [ -n "${unhealthy:-}" ]; then
  echo "✗ 还有服务没健康：" >&2
  echo "$unhealthy" >&2
  exit 1
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}/_nhealth")
[ "$code" = "200" ] || { echo "✗ nginx 本机检查返回 $code" >&2; exit 1; }
echo "==> 好了：本机 http://127.0.0.1:${WEB_PORT}，对外 https://${DOMAIN}"
