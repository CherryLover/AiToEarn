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
/data/aitoearn/  = $DATA_DIR，mongodb / redis / rustfs 数据 + projects 项目物料 + skills 用户传的 AI 技能
  config/      运行时配置覆盖层 server.override.yaml / ai.override.yaml（600），见下一节
```

## 运行时配置覆盖层

### 它是什么

后端的配置分两层读：

```
config.yaml（.env 渲染出来的基石，只读挂载） → config.override.yaml（运行时可改） → zod 校验
```

深合并：对象递归合并，**数组整体替换**（模型清单这种，半个半个合没有意义）。合并完才跑 zod，
所以覆盖层写错一样起不来，和只有 `config.yaml` 时的失败方式一致。**覆盖文件不存在 = 完全没有这一层**，
行为和以前一模一样。

网页 `/config` 页的保存写的就是这一份，而且**只写和 `config.yaml` 不同的那几个键**：
你在页面上没动过的字段不会被冻结成一份同值副本——否则以后改 `.env` 会发现改不动了，
因为覆盖层里压着一份陈旧的旧值。

### 存在哪

| 服务 | 宿主机 | 容器内 | 权限 |
|---|---|---|---|
| `aitoearn-server` | `$DATA_DIR/config/server.override.yaml` | `/app/config.override.yaml` | 读写，600 |
| `aitoearn-ai` | `$DATA_DIR/config/ai.override.yaml` | `/app/config.override.yaml` | 读写，600 |

放在数据盘上，**`deploy.sh` 只在第一次把空文件 `touch` 出来，之后再也不碰**，所以重新部署不会冲掉线上改过的值。
这正是「改了 `.env` 之外的东西下次部署就没了」这个老问题的解法。

`touch` 必须发生在 `docker compose` 之前：Docker 对不存在的宿主机挂载源会直接建成**目录**，
那样这份配置就永远读不到了。

### 和 `.env` 的分工

| | 走 `.env` + `deploy.sh` | 走覆盖层（网页 `/config`） |
|---|---|---|
| 典型内容 | 端口、域名、日志、登录、Mongo / Redis / Redlock、对象存储、物料根目录、服务间地址 | `agent.*` 上游、`ai.*` 模型和 Key、`notify.*`、各平台参数 |
| 改了要干嘛 | 重新部署（重建容器、重连中间件） | 保存即可；`agent` 一段还能不重启就生效 |
| 谁说了算 | 基石，覆盖层动不了 | 覆盖层压在基石之上 |

**受保护的顶层键**（出现在覆盖层里会被当场拒绝，并指名道姓列出是哪几个键路径）：
`port`、`appDomain`、`logger`、`enableConfigLogging`、`enableBadRequestDetails`、`auth`、`mongodb`、
`redis`、`redlock`、`assets`、`serverClient`、`projects`。

这些东西改了要重建容器或重连中间件才有意义，只能从 `.env` 走。

`agent` 这一段保存后**不用重启整个 ai 服务**：`ClaudeCodeRouterService` 重写
`.claude-session/.claude-code-router/config.json` 并重启那个子进程，主进程不动。
注意范围——改上游地址和 Key 立刻生效，改 `agent.models` 清单仍然要重启，
因为可用模型在服务启动时就被吃成 zod 枚举了。

### 备份 / 回滚

就是两个文件，`cat` 出来就能看（**里面有上游 Key，别往外贴**）：

```bash
sudo cp "$DATA_DIR"/config/server.override.yaml{,.bak}
sudo cp "$DATA_DIR"/config/ai.override.yaml{,.bak}
```

回到「只有 `config.yaml`」的状态：把文件清空（`sudo truncate -s 0 ...`）再 `deploy.sh`，
或者在网页上把值改回和基石一样——保存时 diff 为空，覆盖层自己就空了。
文件删掉也行，服务照常起，只是下次 `deploy.sh` 会再 `touch` 一个空的回来。

## 项目物料目录

每个项目在磁盘上有一个自己的目录，放背景物料、发布方向、草稿、图片。这些东西以文件为准，不进数据库。

宿主机位置是 `$DATA_DIR/projects/`，和 mongodb / redis / rustfs 并排，由 `deploy.sh` 建出来。
两个应用容器都把它挂到容器内的 `/data/projects`，可读写，看到的是同一份文件：

| 服务 | 宿主机 | 容器内 | 权限 |
|---|---|---|---|
| `aitoearn-server` | `$DATA_DIR/projects` | `/data/projects` | 读写 |
| `aitoearn-ai` | `$DATA_DIR/projects` | `/data/projects` | 读写 |

## 自定义 AI 技能

用户从设置页传上来的技能落在 `$DATA_DIR/skills`，挂进 `aitoearn-ai` 的 `/data/skills`（读写）。
内置的 15 个技能仍旧打在镜像里，服务启动时两边一起摊进 Agent 读的目录；
上传或删除之后会立刻重新摊一次，不用重启。

格式：标准技能包 `.zip`（`SKILL.md` + `references/` / `scripts/` / `assets/` 等子目录，包 ≤ 10 MiB、解压后 ≤ 30 MiB）
或单个 `.md`（≤ 64 KiB），每个技能在 `$DATA_DIR/skills/<name>/` 下是一整个目录。
目录里偶尔能看到 `.tmp-*` / `.trash-*`，是上传、删除过程中的临时目录，服务会自己清掉，同步也不认它们；
服务没在跑的时候看到残留，可以直接删。`scripts/` 只存不跑。

**必须挂出来**，理由和物料一样：应用容器每次部署都被 `rm --stop --force` 删掉重建。
契约见 `docs/rebuild/contract-custom-skills.md`。

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
/opt/stack/aitoearn/repo/deploy/oci/deploy.sh                     # main 上的最新构建
/opt/stack/aitoearn/repo/deploy/oci/deploy.sh 20260917-1a2b3c4d   # 回到某个指定版本
```

脚本会：仓库切到 `origin/main` → 定版本 → 渲染配置 → 拉镜像 → `docker compose up -d` → 等健康检查。

**不给标签就是升到 main 的最新构建。** 三个镜像各查各的：只改了后台的那次推送不会重建网页镜像，
网页就停在它自己最后一次构建上。找的办法是反查和 `:latest` 同一个 manifest 的那个版本号标签
（`:latest` 只有 main 会打），写进 `.env` 的仍然是版本号而不是 `latest` —— 这样 `docker compose ps`
和日志里看得出线上跑的是哪一版，隔几天原样再跑一次也还是同一版，不会悄悄又升一级。
某个镜像查不到就沿用 `.env` 里的旧值，不会把部署拦下来。

带 `--ref <分支>` 部署时必须显式给标签，脚本会拒绝自动取版本：`:latest` 指的是 main，
把分支的部署文件配上 main 的镜像是最难查的那种错。

### 部署完会顺手清理

健康检查过了之后（**只有过了才清**，中间失败什么都不删，旧镜像还在本地，回滚只要
`deploy.sh <旧标签>`）脚本会收掉这次换下来的东西：

- `ghcr.io/cherrylover/aitoearn-{server,ai,web}` 里当前没有容器在用的标签——每次部署换一版，
  不收的话一版几百 MB 地堆
- 这次 `docker compose pull` 期间新变悬空的层（`rustfs` 和 `mc` 钉的是 `:latest`，重拉就会留一层）
- 本项目没人挂的匿名卷
- `repo/` 的 git 对象（`git gc --auto`）

想留着几版在本地随时回滚，加 `--no-prune`。

**范围是圈死的**：只按 compose 项目名（`aitoearn`）和上面那三个仓库名挑，
脚本里没有一条 `docker system prune` / `docker image prune`——那些按「全机有没有人用」判断，
会把这台机器上 Traefik 和别的项目的东西一起删掉。

容器日志也封了顶（每个容器 3×10MB 滚动，见 `docker-compose.yml` 的 `x-logging`）：
Docker 默认的 json 日志是不封顶的，也没有任何东西会去收它。

## 清空

```bash
deploy.sh clean                # 容器 + compose 网络 + 本项目的所有镜像
deploy.sh clean --data         # 再加上数据盘和渲染出来的 config/
deploy.sh clean --data --yes   # 跳过交互确认（非交互环境下用 --data 必须带 --yes）
```

| | `clean` | `clean --data` |
|---|---|---|
| 容器、compose 网络（外部 `proxy` 网络不动） | 删 | 删 |
| 本项目镜像（含 mongo / redis / rustfs / nginx，别人还在用的会被 docker 拒绝删、自动跳过） | 删 | 删 |
| `$DATA_DIR`：数据库、对象存储、项目物料、运行时配置覆盖层 | **留** | 删，回不来 |
| 渲染出来的 `config/` | **留** | 删 |
| `.env`、`repo/` | 留 | 留 |

不带 `--data` 时再跑一次 `deploy.sh` 就原样回来。`.env` 里有密码和域名，两种模式都不删，
真要连它一起清就 `sudo rm -rf /opt/stack/aitoearn`。

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

## Agent（提炼方向 / 生成草稿）

网页上「让 AI 提炼方向」「生成草稿」跑的**不是** `ai.models.chat` 那组对话模型，而是 `aitoearn-ai` 里内嵌的 Claude Code：
SDK 起 `claude` 进程 → 打本机的 claude-code-router（127.0.0.1:3456）→ router 按 `agent.*` 转给真正的上游。
`OPENAI_BASE_URL` 那组只喂对话和草稿文案，**喂不到这条链路**。

`.env` 里七个变量（见 `.env.example`）：

| 变量 | 作用 | 留空会怎样 |
|---|---|---|
| `AGENT_BASE_URL` | 上游地址，写到哪一层看下面那张表 | 保留仓库占位 `https://api.openai.com/v1/messages` |
| `AGENT_API_KEY` | 上游 Key | 保留仓库占位 `sk-placeholder` |
| `AGENT_MODELS` | 可用模型清单，逗号分隔 | 保留仓库默认那串 `claude-*` |
| `AGENT_DEFAULT_MODEL` | 主模型 | 取清单第一个 |
| `AGENT_BACKGROUND_MODEL` | 子任务模型 | 取清单第一个 |
| `AGENT_THINK_MODEL` | 思考任务模型 | 取清单第一个 |
| `AGENT_TRANSFORMERS` | 跟上游说话的方式，见下表 | 默认 `Anthropic` 透传 |

`.env` 里缺了这几行不会拦下部署：`render_config.py` 会把它们逐个点名，然后按留空处理。
（模板里出现一个 `.env.example` 里也没有的变量名才会报错停下——那是仓库自己写错了。）

**两种协议都能接**，靠 `AGENT_TRANSFORMERS` 区分，claude-code-router 负责转换：

| 上游 | `AGENT_BASE_URL` 写到哪一层 | `AGENT_TRANSFORMERS` |
|---|---|---|
| OpenAI 协议（和 `OPENAI_BASE_URL` 同一个中转站就属于这种） | `/v1/chat/completions` | `none` |
| Anthropic 协议（官方，或上游自己暴露的 anthropic 端点） | `/v1/messages` | 留空 |
| openrouter、deepseek 等 router 自带的 transformer | 按各家文档 | 对应名字，逗号分隔 |

`none` 和留空是两个意思：`none` = 明确不要 transformer，由 router 做 Anthropic ↔ OpenAI 互转；
留空 = 不覆盖，沿用默认的 Anthropic 透传。填反了表现是模型报不存在。

**全留空 = 这个功能是坏的**，不是降级。占位上游会拒掉请求，`claude` 进程往 stderr 打
`There's an issue with the selected model (claude-opus-4-6). It may not exist or you may not have access to it.`，
网页弹窗里照原样显示，最后收一个 `Internal server error`。
没配好时进站会直接跳到 `/setup`，所以不填 `.env` 也可以直接在网页上配，
保存即生效、不用重启；`.env` 这条路的好处是重装机器时它跟着配置一起走。

角色模型填了但不在 `AGENT_MODELS` 里，`render_config.py` 会在渲染阶段就报错停下。
这是故意的——后台启动时 zod 也会拦，但那时的表现是容器起不来，得翻日志才知道为什么。

## 推送（Bark）

草稿生成完、有 manual 工单等着人工去发时，往手机推一条提醒。`.env` 里四个变量（见 `.env.example`）：

| 变量 | 作用 | 留空会怎样 |
|---|---|---|
| `NOTIFY_ENABLED` | 总开关，要真推必须是 `true` | 关掉推送 |
| `NOTIFY_BARK_URL` | Bark 地址，形如 `https://<域名>/<设备 key>/` | 关掉推送 |
| `NOTIFY_BARK_KEY` | 请求头 `bark-key` 的值 | 关掉推送 |
| `NOTIFY_GROUP` | 通知分组，默认 `AiToEarn` | 用默认值 |

`.env` 里缺了这几行不会拦下部署：`render_config.py` 会把它们逐个点名，然后按留空处理。

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
