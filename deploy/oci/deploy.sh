#!/usr/bin/env bash
#
# 在 OCI 服务器上应用一次部署。不构建任何镜像：镜像由 GitHub Actions「Fork Images」构建好推到 ghcr.io。
#
#   /opt/stack/aitoearn/repo/deploy/oci/deploy.sh [镜像标签] [--ref <git 引用>]
#
# 做的事：
#   1. 仓库副本 repo/ 切到指定 git 引用（默认 origin/main），拿到最新的部署文件和官方配置模板
#   2. 给了镜像标签就写回 .env 的 AITOEARN_TAG
#   3. 用 .env 渲染 config/server.yaml、config/ai.yaml
#   4. 建数据目录，拉镜像，docker compose up -d，等健康检查
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

echo "==> 同步部署文件（$REF）"
git -C repo fetch --quiet origin
git -C repo checkout --quiet --detach "$REF"
git -C repo log -1 --format='    %h %s'

if [ -n "$TAG" ]; then
  echo "==> 镜像标签改为 $TAG"
  sed -i "s/^AITOEARN_TAG=.*/AITOEARN_TAG=$TAG/" .env
fi

set -a; . ./.env; set +a
[ -n "${AITOEARN_TAG:-}" ] || { echo "✗ .env 里 AITOEARN_TAG 为空" >&2; exit 1; }

echo "==> 渲染配置"
mkdir -p config
BACKEND=repo/project/aitoearn-backend/apps
python3 repo/deploy/oci/render_config.py "$BACKEND/aitoearn-server/config/config.yaml" repo/deploy/oci/overrides/server.yaml config/server.yaml
python3 repo/deploy/oci/render_config.py "$BACKEND/aitoearn-ai/config/config.yaml" repo/deploy/oci/overrides/ai.yaml config/ai.yaml

echo "==> 数据目录 $DATA_DIR"
sudo mkdir -p "$DATA_DIR"/{mongodb/db,mongodb/configdb,redis,rustfs}
# rustfs 镜像以 uid 10001 运行，数据目录要归它，否则启动报 Permission denied
sudo chown 10001:10001 "$DATA_DIR/rustfs"

echo "==> 拉镜像并启动（$AITOEARN_TAG）"
"${COMPOSE[@]}" pull --quiet
# 基础服务：配置没变就不动
"${COMPOSE[@]}" up -d --remove-orphans mongodb mongodb-rs-init redis rustfs rustfs-init
# 应用服务每次都重建：配置和 nginx.conf 是单文件挂载，重新生成/切换 git 版本会换掉文件，
# 不重建的话容器里看到的还是旧文件
"${COMPOSE[@]}" up -d --force-recreate aitoearn-ai aitoearn-server aitoearn-web nginx

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
