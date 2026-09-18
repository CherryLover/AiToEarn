# 阶段 4 契约（前半段）：手动发布闭环 + 推送通知

> 前置：`contract-core.md`、`contract-skeleton.md`、阶段 0~3 已上线。
> 目标：草稿能变成一张"打包好可以拿去发"的卡片，发完回来登记，整条有记录。

## 范围：这一轮**不做真实发布**

| 做 | 不做 |
|---|---|
| 从草稿建 manual 发布工单，内容快照进去 | ❌ 自动发布（要插件，另一条线） |
| 网页上的发布卡片：一键复制、一键打开平台页 | ❌ **调用任何平台接口** |
| 人工回填链接 → 工单转成功 + 写发布记录 | ❌ claim_link / collect_metrics 的执行 |
| 发布记录：发布状态与链接状态分开 | ❌ 数据采集与回流（阶段 5） |
| Bark 推送通知 | |

**一条红线：这一轮任何代码都不许真的往任何平台发内容。** 走到"生成出内容、打包好给人看"为止。

## 任务划分

| Agent | 可碰文件范围 |
|---|---|
| **A · 发布工单与记录** | `libs/mongodb/src/schemas/published-post.schema.ts` 及 repository、两个 index、`apps/aitoearn-server/src/core/publishing/`（新建）、`libs/common/src/enums/response-code.enum.ts`、`libs/common/src/i18n/messages.ts`、`app.module.ts` |
| **B · 推送通知** | `libs/notify/`（新建 lib）或 `apps/aitoearn-server/src/core/notify/`、`apps/aitoearn-server/src/config.ts`、`apps/aitoearn-ai/src/config.ts`、`deploy/oci/overrides/*.yaml`、`deploy/oci/.env.example`、AI 服务里生成完成的那个钩子 |
| **C · 网页** | `src/api/publishing/`、`src/api/README.md`、`src/app/[lng]/projects/[id]/components/PublishTab/`、`[id]/page.tsx`（只接上这一个标签页）、`src/app/i18n/locales/*/projects.json` |

## 一、Agent A：发布工单与发布记录

### 数据表 `publishedPost`

一条"我们发出去的帖子"。骨架第五节定死了身份和两个状态字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `userId` / `userType` | | |
| `projectId` | string | 索引 |
| `angleId` | string? | 归因用，索引 |
| `draftPath` | string | 来源草稿目录 |
| `platform` | string | 平台标识 |
| `accountId` | string? | 发到哪个号 |
| `snapshot` | Object | 发布那一刻的内容快照：title / body / topics / mediaUrls |
| `executionTaskId` | string? | 对应的执行工单 |
| `publishStatus` | enum | `pending` / `publishing` / `published` / `failed` |
| `linkStatus` | enum | `none` / `claimed` / `claim_failed` |
| `platformPostId` | string? | 平台侧帖子 id |
| `postUrl` | string? | 帖子链接 |
| `publishedAt` | Date? | |

**发布状态和链接状态必须分开**，理由见骨架第五节：「发成功了但没抓到链接」是真实会发生的，合成一个字段就成了模糊地带。

`platform` + `platformPostId` 建**联合唯一索引**（稀疏，允许 null），防止同一条帖子被登记两次。

### 接口

`@Controller('/projects/:projectId/publishing')`，全部要登录、校验项目归属与未归档。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/from-draft` | 从一份草稿建发布工单。body: `{ draftPath, platform, accountId?, mode }`。**这一轮 `mode` 只接受 `manual`，传 `auto` 直接拒绝** |
| GET | `/list` | 发布记录列表，可按状态筛 |
| GET | `/:id` | 详情，含完整快照 |
| POST | `/:id/complete` | 人工回填：body `{ postUrl, platformPostId? }` → 记录转 `published` + `claimed`，工单转 `succeeded` |
| POST | `/:id/fail` | 人工标记发失败：body `{ reason }` |
| DELETE | `/:id` | 删掉这条登记（只删记录和工单，不碰草稿文件） |

### 建工单时必须做的

1. **读草稿文件，把内容快照下来**（走 safe-fs 读 `drafts/<slug>/content.md` 和 `meta.json`）。骨架第四节写明：**必须用快照，不能只存路径**——草稿在排队期间可能被改，发出去的应该是点「准备发布」那一刻的版本
2. 快照里的 `mediaUrls` 用图片名片文件里的 OSS 地址；名片里没有 OSS 地址的图片跳过并在返回里说明
3. 建一条 `publishedPost`（`publishStatus=pending`，`linkStatus=none`）
4. 建一条 `ExecutionTask`（`type=publish`，`mode=manual`，payload 照骨架第四节，`angleId` 从草稿 meta 里带过来）
5. 两者互相引用；任何一步失败要把已建的清理掉

### 回填链接

- `postUrl` 必须是 http/https，长度有限
- 同一个 `platform` + `platformPostId` 已存在就拒绝（唯一索引兜底，也要给人话错误）
- 回填成功时同步把对应工单转 `succeeded`，结果写进工单的 `result`

错误码用 **20500 段**，i18n 补 `en-US` / `zh-CN`。

## 二、Agent B：推送通知（Bark）

### 配置

新增配置项，**值全部来自环境变量，仓库里只放占位**：

```ts
export const notifyConfigSchema = z.object({
  enabled: z.boolean().default(false).describe('没配就静默关掉，不报错'),
  barkUrl: z.string().default('').describe('形如 https://notify.example.com/<设备key>/'),
  barkKey: z.string().default('').describe('请求头 bark-key 的值'),
  group: z.string().default('AiToEarn').describe('通知分组'),
}).default({ enabled: false, barkUrl: '', barkKey: '', group: 'AiToEarn' })
```

- `deploy/oci/overrides/server.yaml` 和 `ai.yaml` 里用 `${NOTIFY_BARK_URL}` 这类占位（注意 render_config.py 的 `$$` 转义规则）
- `deploy/oci/.env.example` 加**空占位**和一句注释说明去哪儿拿
- **真实的地址和 key 只写在服务器的 `/opt/stack/aitoearn/.env`，绝不进仓库**

### 调用方式

```
POST <barkUrl>
Header: bark-key: <barkKey>
Header: Content-Type: application/json
Body:   { "title": "...", "body": "...", "group": "..." }
```

### 硬要求

- **推送失败绝不能影响主流程**。全部 try/catch，失败只记日志
- **没配置就静默跳过**，不要抛错、不要刷日志
- 加超时（5 秒），不要让一次推送把请求挂住
- **不要把用户内容原样塞进推送**——截断到合理长度（标题 30 字、正文 100 字以内），推送是提醒不是投递

### 推什么

这一轮至少接两个点：

1. **AI 生成草稿完成** —— 这是用户最想要的。标题形如「✅ 新草稿生成好了」，正文带项目显示名、方向名、平台、草稿标题
   - 去 AI 服务里找生成任务完成的那个位置接上。先读代码搞清楚任务状态是在哪儿流转的，**在返回里说明你接在了哪里、为什么选那儿**
2. **有发布工单等着人工去发** —— 建 manual 工单时推一条，标题形如「📝 有一条等你去发」

补单测：没配时不发、发失败不影响主流程、内容被正确截断。

## 三、Agent C：网页发布卡片

项目详情页填上第四个标签页（阶段 0 留的占位）。

**「发布」标签页**

- 从草稿列表里选一份 → 选平台 → 点「准备发布」，建出一张卡片
- 卡片上要有：
  - 标题、正文、话题，**各自一个独立的复制按钮**，再加一个「全部复制」
  - 图片缩略图，每张能单独下载；有多张时提供「全部下载」
  - 一个「打开平台发布页」的按钮（各平台的创作后台地址，做成常量表）
  - 发完之后：一个输入框贴帖子链接，点「我发好了」→ 调回填接口
  - 一个「发失败了」的入口，填原因
- 已登记的发布记录列一张表：平台、状态、发布时间、链接（能点开）
- **状态要显示成两个维度**：发布状态和链接状态分开，别合成一个

### 体验要求

- 复制按钮点完要有明确反馈
- 正文可能很长，卡片要能折叠/展开
- 空状态引导：说清楚这一步是把生成好的内容打包出来，你自己去平台发，**不是系统替你发**
- 六种语言文案补齐

### 红线

网页上**不许出现任何"一键自动发布"的按钮或调用**。这一轮就是给人用的打包工具。

## 验收

1. 从一份真草稿建出发布工单，快照内容正确、图片 OSS 地址在
2. 卡片上能复制出完整内容
3. 回填链接后记录转 `published` + `claimed`，工单转 `succeeded`
4. 同一条帖子重复登记被拒
5. 生成草稿时手机收到 Bark 推送
6. 把 Bark 配置清空，一切照常工作、不报错
