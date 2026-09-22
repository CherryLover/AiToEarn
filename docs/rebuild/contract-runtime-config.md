# 配置分层与就绪检查

> 前置：`contract-core.md`、`contract-settings.md`。
> 起因：线上「让 AI 提炼方向」一直报错，根因是 `agent.*` 上游从来没被部署配置覆盖过，
> 一直用仓库里的占位值。而这件事**在网页上完全看不出来**，也**改不了**。

## 一、要解决的两件事

用户原话：

> 整体运行的基石的配置，写在 docker 配置文件或者环境变量里，但是影响到实际功能的表现差异的，
> 可以通过运行时读取配置文件、重加载、或者数据库中的来去实现。
>
> 能不能在打开我们的网页的时候，走一套检查流程，检查我们必须的配置是否配置，
> 如果没有就启动分步配置，把该有的都配置好？

对应两块：**配置分层**（本文第三节）和**就绪检查 + 分步引导**（第四节）。

## 二、现状（动手前先认清）

配置链路是：服务器 `.env` → `deploy.sh` 调 `render_config.py` 渲染出 `config/{server,ai}.yaml`
→ **只读**挂进容器（`docker-compose.yml` 里 `:ro`）→ 后端 `selectConfig` 同步读 + zod 校验。
后端**不读 `process.env`**，这条规矩不变。

网页 `/config` 页能读、能改、能点重启，但**保存必然失败**：文件是只读挂载。
就算能写也留不住，`deploy.sh` 下次部署会重新渲染覆盖。这一点 `contract-settings.md`
里已经写明是知情的取舍——现在把它做完。

## 三、配置分层

### 3.1 覆盖层是一个文件，不是数据库

**决定：运行时覆盖层落在 `config.override.yaml`，挂在数据盘上，不进数据库。**

理由（三选一里为什么选文件）：

- `selectConfig` 是**同步**的，在模块加载期就跑完（`export const config = selectConfig(AppConfig)`）。
  要读数据库就得把它改成异步，连带改 bootstrap 顺序和所有 `import { config }` 的时机——
  为一个覆盖层付这个代价不值。同步读文件零侵入。
- 放在 `${DATA_DIR}/config/` 下，`deploy.sh` 不生成也不碰它，**重新部署不会被覆盖**。
  这正是现在这套坏掉的根因。
- 备份和迁移就是一个文件，出事时能直接 `cat` 出来看，不用连库。

数据库那条路留着：真要多实例共享配置时再说，那时 `appConfigs` 集合已经在了。

### 3.2 读取优先级

```
config.yaml（.env 渲染，基石）  →  config.override.yaml（运行时可改）  →  zod 校验
```

深合并：对象递归合并，**数组整体替换**（模型清单这种，半个半个合没有意义）。
合并完才跑 zod，所以覆盖层写错一样起不来——和现在的行为一致，不新增失败模式。

覆盖文件不存在 = 当前行为，一个字都不变。

### 3.3 哪些不许覆盖

「基石」= 改了要重建容器/重连中间件才有意义的，只能从 `.env` 走。**顶层键白名单取反**：

受保护（拒绝出现在覆盖层里）：
`port`、`appDomain`、`logger`、`enableConfigLogging`、`enableBadRequestDetails`、
`auth`、`mongodb`、`redis`、`redlock`、`assets`、`serverClient`、`projects`

其余全部可覆盖，其中真正用得上的是 `ai.*`、`agent.*`、`notify.*` 和 server 侧的平台相关配置。

覆盖层里出现受保护键 → `ConfigOverrideProtectedKey`，**保存时就拒绝**，不要等启动才炸。
校验要逐个列出违规的键路径，别只说「有非法字段」。

### 3.4 `/config` 页的保存改成写覆盖层

`libs/config-editor`：

| 接口 | 现在 | 改成 |
|---|---|---|
| `GET /` | 读 `config.yaml` | 返回**合并后**的值，外加 `overriddenPaths`（哪些键路径来自覆盖层）和 `protectedPaths` |
| `PUT /` | 整份写回 `config.yaml`（只读挂载，必失败） | 只把**与 base 不同的部分**写进 `config.override.yaml`，base 一个字节都不碰 |
| `POST /validate` | 不变 | 不变，外加受保护键检查 |
| `POST /restart` | 不变 | 不变（pm2-runtime 退出即重启） |

「与 base 不同的部分」= 用提交值和 base 做 diff，只留差异。这样用户在 UI 里没动过的字段
不会被冻结成覆盖值——否则以后改 `.env` 会发现改不动了，因为覆盖层里有一份陈旧的同值副本。

VO（**服务端权威，网页照抄，不要自己起名**）：

```ts
interface ConfigEditorConfigVo {
  config: Record<string, unknown>      // 合并后的值
  format: 'yaml' | 'json'
  overriddenPaths: string[]            // 形如 ['agent.baseUrl', 'ai.openai.apiKey']
  protectedPaths: string[]             // 顶层受保护键，形如 ['auth', 'mongodb']
}
```

### 3.5 `agent` 这一段要能不重启就生效

改上游地址还要重启整个 ai 服务，体验太差。`ClaudeCodeRouterService` 保存后重写
`.claude-session/.claude-code-router/config.json` 并重启那个子进程即可，主进程不动。

范围就到这里：**只有 `agent` 一段做热生效**，其余照旧「保存 → 点重启」。
不要为了通用性去做全量热重载——绝大多数模块是 `forRoot` 在启动时吃掉配置的，
做出来也不会生效，只会骗人。

### 3.6 挂载

`docker-compose.yml`（根目录和 `deploy/oci/` 两份都要）给两个后端各加一个**可写**挂载：

```yaml
- ${DATA_DIR:?}/config/ai.override.yaml:/app/config.override.yaml
- ${DATA_DIR:?}/config/server.override.yaml:/app/config.override.yaml
```

Docker 对不存在的宿主机路径会建成目录，所以 `deploy.sh` 要**在 compose 之前**
`touch` 出这两个空文件（权限 600，里面会有 Key）。

## 四、就绪检查与分步引导

### 4.1 服务端

`GET /system/readiness`（aitoearn-server，要登录），逐项返回，不抛异常：

```ts
interface ReadinessItemVo {
  key: string                                   // 'agentUpstream' | 'aiChatModels' | 'assets' | 'projectsRoot' | 'notify'
  status: 'ok' | 'missing' | 'error'
  required: boolean                             // false 的项不拦人，只提示
  configPath: string | null                     // 'agent.baseUrl'，引导页据此跳到对应字段
  detail: string | null                         // 失败原因原文，给人看的，不做 i18n
}

interface ReadinessVo {
  ready: boolean          // 所有 required 项都是 ok
  items: ReadinessItemVo[]
}
```

检查项（第一轮就这五个）：

| key | required | 怎么判 |
|---|---|---|
| `agentUpstream` | 是 | 走 ai 的内部接口真探一次上游，不是只看非空 |
| `aiChatModels` | 是 | `ai.models.chat` 非空，且 `ai.openai.apiKey` 有值 |
| `assets` | 是 | 对象存储能列一次桶 |
| `projectsRoot` | 是 | 物料根目录存在且可写 |
| `notify` | 否 | **只看配齐没配齐**，配齐了就是 `ok`，没配就是 `missing` |

`agentUpstream` 落在 ai 侧：`GET /internal/readiness`，挂 `@Internal()`，
server 用现成的 `Bearer internalToken` + axios 那套调。**探测就是探测**：
发一个最小的 messages 请求，看回的是不是 2xx；占位值 `sk-placeholder` 会被上游拒掉，
正好就是我们要抓的那个状态。

请求打的是**本机的 claude-code-router**（`127.0.0.1:3456/v1/messages`），不是直连
`agent.baseUrl`。真正跑提炼方向的 `claude` 进程就是这么走的，中间那层 transformer 配错了
（上游说 OpenAI 协议却留着 Anthropic 透传）同样是「用不了」——直连上游探不出这一类问题，
等于报了个假的绿灯。

`notify` 是唯一一项**不真探**的：就绪检查是进站自动跑的，顺手推一条等于每开一次网页
震一下手机，比没配推送还烦。真探活在设置页那个「发送测试通知」按钮上，那是人主动点的。

超时 5 秒。探测失败**不抛异常**，回 `status: 'error'` + `detail`。
整个就绪检查不许影响任何主流程。

**Key 绝不出现在 `detail` 里**，上游返回体也要过一遍再放进去。

### 4.2 网页

- 进站拉一次 `/system/readiness`（放在已登录布局里，未登录不拉），结果缓存在 store，
  同一次会话不重复拉；引导页里保存完再手动复检。
- 有 `required` 项不是 `ok` → 顶部横幅：说清楚坏的是哪个功能（「AI 提炼方向现在用不了」），
  而不是「配置缺失」这种听不懂的话。横幅上一个按钮进引导页。
- `/[lng]/setup` 分步引导：一项一步，每步说明「这是什么、不配会怎样、去哪拿」，
  输入框直接就地填，保存走 `/config` 那套覆盖层接口，保存完当场复检这一项，绿了才放行下一步。
- 已经 `ok` 的步骤默认折叠，允许跳过非必需项。
- **「默认模型」是下拉，选项去上游真拉**（`GET /system/agent-models` → ai 的
  `GET /internal/agent-models` → 按 `agent.baseUrl` 推出 `<前缀>/v1/models` 问一次）。
  拉不到也回 200、原因写在 `detail` 里，那一格**退回手填输入框**——上游不支持列模型接口
  的情况是存在的，不能因此把这一步变成死路。
- **选中一个模型要连着改三处**：`agent.defaultModel`、`agent.models`，以及
  `backgroundModel` / `thinkModel` 里那些在新清单里找不到的。
  后台的校验是「三个角色模型都必须在 `agent.models` 里」，只写 `defaultModel` 会让保存
  被整份拒掉，而且拒掉之后配置里留的还是旧模型名——就绪检查再去探，报的错里写的是**旧模型**，
  跟人刚填的对不上号。拉到清单时按清单判哪些角色模型还算数，拉不到（手填）就一项都不删、
  只把填的这个追加进原清单。顺带对齐了哪几项要在界面上说出来，不许偷偷改用户的配置。
- 全部通过 → 一句话收尾 + 回首页。
- 六种语言文案补齐；手机宽度不横向滚动；复用设置页那套外壳和交互约定，不要另起一套。

### 4.3 上游协议不限 Anthropic

`agent.transformers` 决定怎么跟上游说话，claude-code-router 负责两边转换：

| 上游 | `agent.baseUrl` 写到哪一层 | `agent.transformers` |
|---|---|---|
| OpenAI 协议（和 `ai.openai` 同一个中转站就属于这种） | `/v1/chat/completions` | `[]`（`.env` 里填 `none`） |
| Anthropic 协议（官方，或上游自己暴露的 anthropic 端点） | `/v1/messages` | `['Anthropic']`（默认，`.env` 里留空） |
| openrouter、deepseek 等 router 自带的其它 transformer | 按各家文档 | 对应名字 |

默认值保持 `['Anthropic']` 不变，是为了不动既有部署的行为。空数组和「整个字段不给」
在 router 那边是两回事：只有不给 `transformer` 字段，它才会走缺省的 Anthropic ↔ OpenAI 互转，
所以生成 router 配置时空数组要整个字段省掉，不能写成 `use: []`。

## 五、错误码

`20800-20849` 运行时配置覆盖，`20850-20899` 就绪检查。已在 `response-code.enum.ts`
和 `i18n/messages.ts` 里建好，直接用，**不要自己新增编号**。

## 六、验收

1. 网页 `/config` 改一个 `agent.baseUrl` 保存，**不再报只读失败**；`config.override.yaml` 里只多了这一个键
2. 重新跑一次 `deploy.sh`，刚才那个覆盖值**还在**
3. 覆盖层里手写一个 `auth.secret`，保存被拒，提示指名道姓说是哪个键
4. 上游没配时进站有横幅，点进引导页能一步步填完，填完横幅消失
5. 改完 `agent.baseUrl` 不重启服务，直接去提炼方向，用的是新上游
6. 覆盖文件删掉，服务照常起，行为回到只有 `config.yaml` 的样子
