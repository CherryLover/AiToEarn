#!/usr/bin/env bash
#
# 在 OCI 服务器上应用一次部署，或者把这个项目从服务器上清干净。
# 不构建任何镜像：镜像由 GitHub Actions「Fork Images」构建好推到 ghcr.io。
#
#   /opt/stack/aitoearn/repo/deploy/oci/deploy.sh [镜像标签] [--ref <git 引用>] [--no-prune]
#   /opt/stack/aitoearn/repo/deploy/oci/deploy.sh clean [--data] [--yes]
#
# 部署做的事：
#   1. 仓库副本 repo/ 切到指定 git 引用（默认 origin/main），拿到最新的部署文件和官方配置模板
#   2. 定版本：给了镜像标签就用它，没给就取 main 上构建出来的最新版本，写回 .env
#   3. 用 .env 渲染 config/server.yaml、config/ai.yaml
#   4. 建数据目录（含运行时配置覆盖层的空文件），拉镜像，docker compose up -d，等健康检查
#   5. 成功之后顺手清掉这次换下来的旧镜像和悬空层（`--no-prune` 可跳过）
#
# **这台机器上不止这一个项目**（至少还有 Traefik）。所以整个脚本里没有一条
# `docker system prune` / `docker image prune`：那些命令按「全机有没有人用」判断，
# 会把别人的东西一起删掉。这里所有清理都按 compose 项目名和我们自己的镜像仓库名圈定范围。
#
set -euo pipefail

STACK_DIR=/opt/stack/aitoearn
COMPOSE=(docker compose --project-directory "$STACK_DIR" --env-file "$STACK_DIR/.env" -f "$STACK_DIR/repo/deploy/oci/docker-compose.yml")

# compose 文件里的 `name:`，也就是每个容器/网络上的 com.docker.compose.project 标签值。
# 所有「只删我们自己的东西」都靠它圈范围
PROJECT=aitoearn

# 我们自己构建、会随版本不断堆积的三个镜像仓库。基础镜像（mongo、redis、nginx…）
# 标签是固定的，不会越堆越多，部署时不碰；只有 clean 才会连它们一起收
APP_IMAGE_REPOS=(
  ghcr.io/cherrylover/aitoearn-server
  ghcr.io/cherrylover/aitoearn-ai
  ghcr.io/cherrylover/aitoearn-web
)

usage() {
  cat <<'USAGE'
用法：
  deploy.sh [镜像标签] [--ref <git 引用>] [--no-prune]
      部署。不给标签 = 升到 main 上的最新构建。
      --ref        部署文件和配置模板取哪个 git 引用，默认 origin/main。
                   非 main 时必须同时显式给镜像标签。
      --no-prune   部署完不清理换下来的旧镜像（想留着几版在本地随时回滚时用）。

  deploy.sh clean [--data] [--yes]
      把这个项目从服务器上清掉。默认清：容器、compose 网络、本项目的所有镜像。
      **保留** 数据盘 $DATA_DIR、.env、repo/、渲染出来的 config/，再跑一次 deploy.sh 就能原样回来。
      --data       连数据盘和渲染出来的 config/ 一起删。数据库、对象存储、项目物料、
                   运行时配置覆盖层全没，且不可恢复。
      --yes        不要交互确认（非交互环境下用 --data 必须带它）。
USAGE
}

CMD=deploy
TAG=""
REF="origin/main"
PRUNE=1
CLEAN_DATA=0
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    clean) CMD=clean; shift ;;
    --ref) REF="$2"; shift 2 ;;
    --no-prune) PRUNE=0; shift ;;
    --data) CLEAN_DATA=1; shift ;;
    -y | --yes) ASSUME_YES=1; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) echo "✗ 不认识的选项 $1" >&2; usage >&2; exit 1 ;;
    *) TAG="$1"; shift ;;
  esac
done

cd "$STACK_DIR"
[ -f .env ] || { echo "✗ 缺少 $STACK_DIR/.env，照 repo/deploy/oci/.env.example 填好" >&2; exit 1; }

# ---- 清理用的零件 ---------------------------------------------------------
# 都只按 compose 项目名（PROJECT）或我们自己的仓库名（APP_IMAGE_REPOS）圈范围，
# 不用任何「全机没人用就删」的命令，别的项目的东西一个都不碰。

# 这个项目的容器（含已停止的）现在用着哪些镜像，一行一个 sha256 全 id
project_image_ids() {
  local ids
  ids=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" -q) || return 0
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086
  docker inspect --format '{{.Image}}' $ids 2>/dev/null || true
}

# 全机当前的悬空镜像 id。配合前后两次快照用：只删「我们这次拉镜像期间新变悬空的」，
# 别人项目留下的悬空层不归我们管
dangling_image_ids() {
  docker images --filter dangling=true --no-trunc -q 2>/dev/null | sort || true
}

# 删掉本项目镜像仓库里没人用的标签。删了几个写进全局 PRUNED_IMAGES——
# 不用 echo 回传，那样删掉哪些的日志会被调用方的管道一起吃掉。
#   $1 = keep（默认）：保留当前容器正在用的那些，其余删掉
#      = all：一个不留（clean 用）
PRUNED_IMAGES=0
prune_app_images() {
  local mode="${1:-keep}" keep="" id ref
  PRUNED_IMAGES=0
  [ "$mode" = "all" ] || keep=$(project_image_ids)
  for repo in "${APP_IMAGE_REPOS[@]}"; do
    while read -r id ref; do
      [ -n "$id" ] || continue
      # keep 里一行一个 sha256:... 全 id
      if [ -n "$keep" ] && printf '%s\n' "$keep" | grep -qFx "$id"; then
        continue
      fi
      if docker rmi "$ref" >/dev/null 2>&1; then
        echo "    镜像 $ref"
        PRUNED_IMAGES=$((PRUNED_IMAGES + 1))
      fi
    done < <(docker images --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}}' "$repo" 2>/dev/null)
  done
  return 0
}

# 删掉「这次拉镜像期间新变悬空的」那些层。$1 是拉之前那张快照。
# 逐个和快照比对，而不是 `docker image prune`：后者按全机判断，会连别人的一起删
PRUNED_DANGLING=0
prune_new_dangling() {
  local before="$1" now id
  PRUNED_DANGLING=0
  now=$(dangling_image_ids)
  [ -n "$now" ] || return 0
  while read -r id; do
    [ -n "$id" ] || continue
    printf '%s\n' "$before" | grep -qFx "$id" && continue
    docker rmi "$id" >/dev/null 2>&1 && PRUNED_DANGLING=$((PRUNED_DANGLING + 1))
  done <<< "$now"
  [ "$PRUNED_DANGLING" -gt 0 ] && echo "    悬空层 $PRUNED_DANGLING 个"
  return 0
}

# 本项目那些没人挂的匿名卷。带 com.docker.compose.project 标签的才算我们的
prune_project_volumes() {
  local vols
  vols=$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --filter dangling=true -q 2>/dev/null) || return 0
  [ -n "$vols" ] || return 0
  # shellcheck disable=SC2086
  docker volume rm $vols >/dev/null 2>&1 || true
  echo "    匿名卷 $(printf '%s\n' "$vols" | wc -l) 个"
  return 0
}

# 要动不可逆的东西之前问一句。--yes 跳过；非交互环境下没给 --yes 就拒绝执行，
# 不能因为「反正读不到输入」就默认当成同意
confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  if [ ! -t 0 ]; then
    echo "✗ 非交互环境要跑这一步，请显式加 --yes" >&2
    return 1
  fi
  local answer=""
  printf '   确定就输入 %s 回车（其它任何输入都算取消）：' "$PROJECT"
  read -r answer
  [ "$answer" = "$PROJECT" ]
}

if [ "$CMD" = "clean" ]; then
  set -a; . ./.env; set +a

  # --data 最后会跑 sudo rm -rf "$DATA_DIR"，先确认这个值确实像个数据目录，
  # 而且要在删任何东西**之前**确认——不能先把镜像删了才发现这一步做不了。
  # `/*/*` 要求至少两层，顺手挡掉空值、相对路径、`/` 和 `/data` 这种
  if [ "$CLEAN_DATA" = "1" ]; then
    case "${DATA_DIR:-}" in
      /*/*) ;;
      *) echo "✗ .env 里的 DATA_DIR 是「${DATA_DIR:-（空）}」，不像数据目录，不敢删" >&2; exit 1 ;;
    esac
  fi

  echo "将要删掉："
  echo "    $PROJECT 项目的全部容器和 compose 网络（外部的 proxy 网络不动）"
  echo "    compose 里用到的全部镜像（含 mongo / redis / rustfs / nginx 这些基础镜像，别人还在用的删不掉，会自动跳过）"
  if [ "$CLEAN_DATA" = "1" ]; then
    echo "    数据盘 $DATA_DIR —— 数据库、对象存储、项目物料、运行时配置覆盖层，删了回不来"
    echo "    渲染出来的 $STACK_DIR/config/"
  else
    echo "  保留：$DATA_DIR、$STACK_DIR/{.env,repo,config}。再跑一次 deploy.sh 就原样回来"
    echo "       要连数据一起删，加 --data"
  fi
  confirm || { echo "已取消，什么都没动"; exit 1; }

  echo "==> 停掉并删除容器和网络"
  # --volumes 只删这个 compose 项目自己的卷；外部的 proxy 网络 compose 不会动
  "${COMPOSE[@]}" down --remove-orphans --volumes || true

  echo "==> 删镜像"
  # compose 自己报出这套编排用到的全部镜像，省得基础镜像换了这里忘记跟
  compose_images=$("${COMPOSE[@]}" config --images 2>/dev/null || true)
  if [ -n "$compose_images" ]; then
    while read -r ref; do
      [ -n "$ref" ] || continue
      # 别人还在用的镜像 docker 会拒绝删，正好，跳过就是了
      docker rmi "$ref" >/dev/null 2>&1 && echo "    镜像 $ref"
    done <<< "$compose_images"
  fi
  # 上面只覆盖 .env 当前钉着的那三个版本，历史版本还堆在本地，这里一并收掉
  prune_app_images all
  prune_project_volumes

  if [ "$CLEAN_DATA" = "1" ]; then
    echo "==> 删数据盘"
    sudo rm -rf "$DATA_DIR"
    rm -rf "$STACK_DIR/config"
    echo "    $DATA_DIR 和 $STACK_DIR/config 已删除"
  fi

  echo "==> 清完了"
  echo "    还留在机器上的：$STACK_DIR/.env（密码和域名）、$STACK_DIR/repo（仓库副本）"
  [ "$CLEAN_DATA" = "1" ] || echo "                    $DATA_DIR（数据）"
  echo "    这些要不要留自己决定，删掉就是 sudo rm -rf $STACK_DIR"
  exit 0
fi

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
  reexec=()
  [ -n "$TAG" ] && reexec+=("$TAG")
  reexec+=(--ref "$REF")
  [ "$PRUNE" = "0" ] && reexec+=(--no-prune)
  exec "$STACK_DIR/repo/deploy/oci/deploy.sh" "${reexec[@]}"
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
# 拉之前拍一张悬空镜像的快照。rustfs 和 mc 钉的是 :latest，重新拉会把旧的那层变成悬空；
# 拉完再拍一张，差集就是「这次拉出来的垃圾」——只删这些，别人项目的悬空层不碰
dangling_before=$(dangling_image_ids)
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

# 清理放在健康检查**之后**：这一版跑起来了，上一版才真的可以扔。
# 中间失败了就什么都不删，旧镜像还在本地，回滚只要 deploy.sh <旧标签>，不用重新拉
if [ "$PRUNE" = "1" ]; then
  echo "==> 清理换下来的旧东西"
  prune_app_images keep
  prune_new_dangling "$dangling_before"
  prune_project_volumes
  # 仓库副本每次 fetch 都在长，交给 git 自己判断要不要打包
  git -C repo gc --auto --quiet || true
  if [ "$PRUNED_IMAGES" = "0" ] && [ "$PRUNED_DANGLING" = "0" ]; then
    echo "    没有可清的"
  fi
  docker system df --format '{{.Type}}\t{{.Size}}\t{{.Reclaimable}}' 2>/dev/null \
    | awk -F'\t' '$1 == "Images" { print "    本机镜像共 "$2"，其中 "$3" 没有容器在用" }' || true
fi

echo "==> 好了：本机 http://127.0.0.1:${WEB_PORT}，对外 https://${DOMAIN}"
