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
/data/aitoearn/  = $DATA_DIR，mongodb / redis / rustfs 数据 + projects 项目物料
```

## 项目物料目录

每个项目在磁盘上有一个自己的目录，放背景物料、发布方向、草稿、图片。这些东西以文件为准，不进数据库。

宿主机位置是 `$DATA_DIR/projects/`，和 mongodb / redis / rustfs 并排，由 `deploy.sh` 建出来。
两个应用容器都把它挂到容器内的 `/data/projects`，可读写，看到的是同一份文件：

| 服务 | 宿主机 | 容器内 | 权限 |
|---|---|---|---|
| `aitoearn-server` | `$DATA_DIR/projects` | `/data/projects` | 读写 |
| `aitoearn-ai` | `$DATA_DIR/projects` | `/data/projects` | 读写 |

容器内路径同时写进两份渲染配置的 `projects.root`（来自 `overrides/server.yaml`、`overrides/ai.yaml`），代码读配置拿这个根目录，不要写死。

属主：这两个镜像的 Dockerfile 都没有 `USER`，容器里跑的是 root（uid 0），所以 `sudo mkdir` 建出来的 `root:root` 目录直接就能读写，不需要像 rustfs 那样 `chown`。哪天镜像加了 `USER`，`deploy.sh` 里要补上对应的 `chown`。

**为什么必须挂出来**：`deploy.sh` 每次部署都会 `rm --stop --force` 掉 `aitoearn-ai` / `aitoearn-server` / `aitoearn-web` / `nginx` 再重建。只存在容器里的文件重新部署一次就没了，物料必须落在宿主机上。

### `DATA_DIR` 怎么设

在服务器的 `/opt/stack/aitoearn/.env` 里，默认 `/data/aitoearn`（挂的数据盘）。

想让物料目录和 `docker-compose.yml` 放在一起，就把它指到项目目录下的 `data`：

```bash
DATA_DIR=/opt/stack/aitoearn/data
```

**必须写绝对路径**：`deploy.sh` 拿它直接 `sudo mkdir -p`，compose 也拿它做挂载源，相对路径会建到当时的工作目录去。改完这个值等于换了一套数据目录，老数据要自己搬过去。

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

## 推送（Bark）

草稿生成完、有 manual 工单等着人工去发时，往手机推一条提醒。`.env` 里四个变量（见 `.env.example`）：

| 变量 | 作用 | 留空会怎样 |
|---|---|---|
| `NOTIFY_ENABLED` | 总开关，要真推必须是 `true` | 关掉推送 |
| `NOTIFY_BARK_URL` | Bark 地址，形如 `https://<域名>/<设备 key>/` | 关掉推送 |
| `NOTIFY_BARK_KEY` | 请求头 `bark-key` 的值 | 关掉推送 |
| `NOTIFY_GROUP` | 通知分组，默认 `AiToEarn` | 用默认值 |

**四行必须留在 `.env` 里（可以是空值）**：`render_config.py` 是严格替换，缺变量直接 KeyError，配置渲染不出来。

**真实地址和 key 只写在服务器的 `/opt/stack/aitoearn/.env`，绝不进仓库。**

三样（开关 / 地址 / key）配齐了才真推，缺一样就静默关掉：不推、不抛错、不刷日志。推送本身也只是旁支——超时 5 秒、失败只记一行 warn，绝不影响草稿生成和发布工单。

### 留空到底渲染成什么

`.env` 里 `NOTIFY_ENABLED=` 这种空值，在 override 模板里是 `enabled:`，YAML 解析成 null，`render_config.py` 的 `prune()` 会把整个键丢掉。所以「清空配置」得到的不是一堆空字符串，而是 `notify: {}`（或只剩 `group`），由代码里的默认值兜底。

这条链路有单测锁着，改配置 schema 前先看：

- `apps/aitoearn-server/src/core/notify/notify.config.spec.ts`
- `apps/aitoearn-ai/src/core/notify/notify.config.spec.ts`

用例里的输入就是真跑 `render_config.py` 渲染出来的四种形态，文件头有复现命令。**别把这几个字段改成 required**：配置是进程启动时用 zod 校验的，校验不过不是推送不工作，是服务直接起不来。

### 待办：下次重启窗口实跑一次

契约的验收项「把 Bark 配置清空，一切照常工作、不报错」只在本地测过，**线上没实跑过**——要清空就得改 `.env` 再重新部署，上线那一轮没有这个窗口。下次有计划内的重启窗口时顺手做一次：

```bash
cd /opt/stack/aitoearn
cp .env .env.bak                                        # 先备份
sed -i 's/^NOTIFY_ENABLED=.*/NOTIFY_ENABLED=/' .env     # 只清总开关，地址和 key 不动
repo/deploy/oci/deploy.sh                               # 只更新配置，沿用现有镜像标签

# 期望：两个都是「缺省，等于关」。别直接 cat 渲染出来的配置，里面有真实的 key
for f in config/server.yaml config/ai.yaml; do
  python3 -c "import yaml,sys;n=yaml.safe_load(open(sys.argv[1])).get('notify') or {};print(sys.argv[1],'enabled =',n.get('enabled','缺省，等于关'))" "$f"
done

C="docker compose --project-directory . --env-file .env -f repo/deploy/oci/docker-compose.yml"
$C ps                                                   # 期望：server / ai 都 healthy
$C logs --tail=200 aitoearn-server | grep -ic bark      # 期望：0，一条推送日志都没有
mv .env.bak .env && repo/deploy/oci/deploy.sh           # 复原，再确认一次 healthy
```

顺手也验一下反面：复原之后在网页上生成一份草稿，手机应该收到「✅ 新草稿生成好了」。
