# OCI 部署

把 fork 版 AiToEarn 部署到 OCI 免费 ARM 机（Ubuntu 24.04 arm64）。

- 对外地址：https://pub.flyooo.uk （网页 + `/api` + `/oss`），浏览器直传文件用 https://pub-oss.flyooo.uk
- 入口：服务器上现有的 Traefik（`proxy` 网络，Let's Encrypt 证书）接到 nginx 容器；`pub` 走 Cloudflare 橙云，`pub-oss` 走灰云（避开 Cloudflare 单次 100MB 上传限制）
- 登录：代码里接了 Pocket ID（OIDC），见 `project/aitoearn-backend/apps/aitoearn-server/src/core/oidc-login/`。官方开源版的自动登录（把 100 年有效的管理员凭证写进每个访客拿到的页面）已经不用，网页可以直接公开

## 镜像从哪来

服务器不构建镜像。GitHub Actions「Fork Images」（`.github/workflows/fork-images.yml`）构建 `ghcr.io/cherrylover/aitoearn-{server,ai,web}`，只打 arm64，标签是 `日期-提交号` 和 `latest`。

- 后台代码（`project/aitoearn-backend/`）有改动 → 构建 server、ai
- 网页代码（`project/aitoearn-web/`）有改动 → 构建 web
- 也可以在 Actions 页面手动运行，填要构建的应用

官方的 `backend-build` / `web-build`（推官方 Docker Hub）和飞书通知在 fork 里已停用，文件保留，方便同步上游。

## 服务器上的目录

```
/opt/stack/aitoearn/
  repo/        fork 的仓库副本（deploy.sh 切到指定引用）
  .env         密码、域名、镜像标签（600，照 .env.example 填）
  config/      deploy.sh 渲染出的 server.yaml / ai.yaml（600）
/data/aitoearn/  mongodb / redis / rustfs 数据
```

## 部署 / 更新

```bash
/opt/stack/aitoearn/repo/deploy/oci/deploy.sh 20260917-1a2b3c4d   # 指定镜像标签
/opt/stack/aitoearn/repo/deploy/oci/deploy.sh                     # 只更新配置，沿用 .env 里的标签
```

脚本会：仓库切到 `origin/main` → 写入镜像标签 → 渲染配置 → 拉镜像 → `docker compose up -d` → 等健康检查。

配置合并规则（`render_config.py`）：官方 `config.yaml` 为底，`overrides/*.yaml` 覆盖；override 值为空的项保留官方默认；server 配置里 `https://localhost/` 开头的地址统一换成 `https://$DOMAIN/`；没填 `OIDC_CLIENT_ID` 时不写登录配置（服务能起，但登录不了）。

## 常用

```bash
cd /opt/stack/aitoearn
C="docker compose --project-directory . --env-file .env -f repo/deploy/oci/docker-compose.yml"
$C ps
$C logs -f aitoearn-server
```

## 插件

插件「自定义配置」填：主页 `https://pub.flyooo.uk`、API `https://pub.flyooo.uk/api`、OSS `https://pub.flyooo.uk/oss`；「允许注入的域名」加 `https://pub.flyooo.uk/`。

## 登录（Pocket ID）

- Pocket ID 客户端回调地址：`https://pub.flyooo.uk/api/auth/oidc/callback`
- `.env` 填 `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`，`OIDC_ALLOWED_EMAILS` 是允许登录的邮箱（逗号分隔）
- 名单里的邮箱第一次登录自动建号；签发的登录凭证默认 30 天有效，格式和官方一致，插件照常读取
