# 项目级 AI 对话面板与方向待确认

> 前置：`contract-core.md`、`contract-stage2.md` 已上线。
> 目标：项目详情页右侧常驻一条 AI 对话，方向和内容都在这条对话里聊出来；
> AI 提炼的方向默认进库但标成待确认，人点了才算数。

## 一、为什么改

现在「让 AI 提炼方向」是一个一次性弹窗（`AnglesTab/ExtractAnglesDialog.tsx`）：
点一下，跑一段固定提示词，把过程当日志刷出来，跑完关掉，什么都不剩。

三个问题：

1. **聊不了**。想法往往是聊出来的——先说个模糊的念头，AI 问两句，补点材料，才谈得上提炼。弹窗只能单向发一次。
2. **看不见它在干什么**。现在只把文字流拼成日志行，AI 读了哪些物料、写了哪些文件、待办列表走到哪一步，全丢了。
3. **跑完直接入库**。AI 提五个方向，五个全进列表，好的坏的混在一起，方向列表很快就脏了。

顺带一个历史包袱：弹窗当初为了不改公共模块，另写了一份 `useProjectAgentTask.ts`
（文件头注释里写明了「不去改别人的模块」）。这一轮把这条绕路拆掉，回到公共的 `store/agent`。

## 二、已经有的东西，一律复用，不许另写一套

动手前先把这几处读一遍，**这一轮 90% 的能力是接线，不是新建**：

| 已有 | 位置 | 能干什么 |
|---|---|---|
| Agent 状态管理 | `src/store/agent/` | 每个任务一个 TaskInstance，SSE 收发、多轮续聊、工具调用步骤、消息列表 |
| 聊天组件 | `src/components/Chat/` | 消息气泡、输入框、工具调用展示与详情弹窗、历史会话列表、评分 |
| 聊天页 | `src/app/[lng]/chat/[taskId]/` | 断线重连轮询、滚动控制的现成实现，照抄思路 |
| 服务端多轮 | `apps/aitoearn-ai` | 带 `taskId` 即续聊，`messages` 本来就存库，`projectName` 会把工作目录锁进项目物料目录 |

**不要新建请求封装、不要新建状态管理、不要把聊天逻辑再抄一份到 projects 目录下。**
页面私有组件不许 import `src/app/[lng]/chat/...`，要复用就提升到 `components/Chat/`。

## 三、地基（已完成，两条线都依赖它，不要改）

### 3.1 会话记录归属项目

`ContentGenerationTask` 增加：

| 字段 | 说明 |
|---|---|
| `projectName?: string` | 项目英文名（即目录名），建任务时写入，**续聊不改**。带索引 |

**为什么存名字不存 id**：`aitoearn-ai` 只认项目目录名，拿不到 `aitoearn-server` 那边的项目主键；
网页两个都有，`projectId ↔ projectName` 的映射在网页做。别在 AI 服务里反查项目表。

配套：

- 列表接口 `GET agent/tasks` 增加 query `projectName?`，按项目筛会话
- 任务详情与列表 VO 带出 `projectName`
- 不带 `projectName` 的老会话行为完全不变

### 3.2 公共对话状态带上项目

- `api/ai` 的 `CreateAgentTaskParams` 增加 `projectName?: string`
- `store/agent` 的 `ICreateTaskParams` 增加 `projectName?: string`，`createTask` / `continueTask` 原样透传

### 3.3 两条线的分界（照这个分，不会撞车）

两条线唯一会碰到同一个文件的地方是 `AnglesTab/index.tsx`。按下面这样分就不会撞：

| | 线 A | 线 B |
|---|---|---|
| 自己的目录 | `ProjectChatPanel/` | `AnglesTab/PendingAngles/` |
| 独占文件 | `projects/[id]/page.tsx`、`AnglesTab/index.tsx`、`angles.utils.ts`、`components/Chat/`、`store/agent/` | `core/angles/`、`angle.schema.ts`、`angle.repository.ts`、`api/angles/`、`AnglesTab/useAngles.ts` |

**线 B 不要动 `AnglesTab/index.tsx`。** 待确认区做成一个自包含组件交出来，由线 A 挂上去。约定的签名：

```tsx
// AnglesTab/PendingAngles/index.tsx
interface PendingAnglesProps {
  projectId: string
  /** 归档项目只读 */
  readOnly: boolean
  /** 采用或删除之后通知外面刷新已确认的列表 */
  onChanged: () => void
}
```

`useAngles` 归线 B，新增的待确认相关状态和方法加在这里，已有的 `refresh` / `sync` / `create` / `derive` / `update` / `remove` 签名不许改——线 A 的接线依赖它们。

对话面板和方向页的联动只有一条：

```
面板：任务跑完 → onTaskFinished()
页面：onTaskFinished → 调 sync，再 refresh
```

线 A 负责把这条接起来，线 B 只要保证 sync 之后 AI 写的方向是待确认状态就行。

## 四、线 A：对话面板（前端）

可碰范围见 3.3 的表。

### 4.1 面板形态

**非模态的右侧常驻栏，不是弹窗、不是遮罩式抽屉。**

人要一边看方向列表一边跟 AI 聊，`ui/sheet.tsx` 那种覆盖式抽屉会把列表挡住，不能用。

- 宽屏（≥1280px）：面板占右侧固定宽度，**主体内容收窄让位**，不遮挡
- 窄屏：退化成覆盖式，允许用 `sheet`
- 开关状态、宽度记在浏览器本地；读写失败（无痕模式）按默认处理，不提示不打断
- 挂在**项目详情页那一层**，不是挂在「方向」标签页里——切到「生成」标签页，同一条对话还在

### 4.2 会话怎么组织

**一个项目一条当前会话，可新开，可翻历史。**

- 打开面板：按 `projectName` 拉这个项目最近一条会话作为当前会话，把历史消息灌进来
- 发消息：有当前会话就续聊（带 `taskId`），没有就新建
- 「新开一条」：清掉当前会话，下一条消息会建新任务
- 「历史会话」：按 `projectName` 筛的会话列表，复用 `Chat/TaskHistoryList.tsx`，点一条切过去
- 面板关掉任务还在跑，重开要能接上——照 `chat/[taskId]/hooks/useTaskPolling.ts` 的做法做增量轮询，不要另写

### 4.3 工具调用展示

工具调用**已经在收了**（`store/agent/task-instance/sse.handler.ts` 把 `tool_use` 存成带工具名、入参、结果的步骤），
现在只是通用地显示一行工具名。这一轮把常用的几个做细：

| 工具 | 要显示成什么 |
|---|---|
| Read / Write / Edit | 一行文件路径 + 动作，**路径必须相对项目物料目录** |
| TodoWrite | 渲染成清单，勾选状态原地更新，不要每次追加一份新的 |
| Glob / Grep | 匹配式 + 命中数量 |
| 其他 | 保持现在的通用展示 |

**路径一律转成相对项目目录再显示。** 服务器绝对路径不许出现在界面上：
既是没必要暴露目录结构，也是因为那串路径对用户毫无意义。

### 4.4 提炼方向改成往对话里说一句话

- 删掉 `ExtractAnglesDialog.tsx` 和 `useProjectAgentTask.ts`
- 「让 AI 提炼方向」按钮改成：打开面板 → 往当前会话发一条提炼提示词 → 跟平时聊天一样走
- 提示词（`angles.utils.ts` 的 `buildExtractAnglesPrompt`）要重写：
  现在是「读物料去提炼」，改成 **「结合我们这条对话里已经聊到的东西，再读 `background/`」**。
  不改这句，AI 会无视前面聊的半小时，从头读物料重来一遍

配套要改技能文档 `apps/aitoearn-ai/src/core/agent/skills/extracting-angles/SKILL.md`：

- 允许把**本轮对话里人给的信息**当作输入
- **铁律不变：事实不许编**。对话里人说的算材料，但要在方向文件的 frontmatter 里标明这条来自对话而不是某个物料文件
- 已有方向仍然要先读一遍，不提重复的

## 五、线 B：方向待确认（后端 + 方向页）

可碰范围见 3.3 的表。**不要动 `AnglesTab/index.tsx`。**

### 5.1 数据结构

`Angle` 增加：

| 字段 | 说明 |
|---|---|
| `confirmedAt?: Date` | 人确认采用的时间。空 = 待确认 |

**为什么不往 `AngleStatus` 里加一个 `pending`**（这条别改主意，改了要返工）：

`status` 记的是「这个假设验到哪一步了」——候选、测试中、有效、淘汰，是一条生命线。
「人看过没有」是另一个维度。混成一个枚举会立刻出问题：一条待确认的方向本身也有候选/测试中的状态，
硬塞进同一个字段就得表达「待确认的有效方向」这种说不通的东西。
而且 `AngleStatus` 是前后端共用的契约，动它要连带改 `ANGLE_STATUS_ORDER`、
树形展示、状态分组、状态筛选和全部语言的文案，成本几倍。

### 5.2 谁是待确认的

| 来源 | `confirmedAt` |
|---|---|
| 手建（`/create`） | 建的时候就写 `now`。人自己建的，不用再确认一遍 |
| 派生（`/derive`） | 同上，写 `now` |
| AI 登记（`/sync`） | **不写**，即待确认 |

**存量数据一次性补齐**：现有方向全部视为已确认，写一个迁移把 `confirmedAt` 补成 `createdAt`。
不要在读取逻辑里到处判空来兼容老数据——判空会散到列表、树、分组、筛选每一处，迟早漏一个。

迁移**必须是纯 mongosh 脚本**放在后端的 `migrations/` 目录下（仓库规矩，见
`project/aitoearn-backend/.claude/rules/project-standards.md`），不许写成 NestJS 的 Service 或 Controller。
该目录现在还不存在，这一轮新建。

### 5.3 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/:angleId/confirm` | 确认单条，写入 `confirmedAt` |
| POST | `/confirm` | 批量确认，body `{ angleIds: string[] }` |

- `GET /list` 增加 query `confirmed?: boolean`：不传 = 全部，`true` = 只看已确认，`false` = 只看待确认
- `GET /tree` **只含已确认的**。演进树是用来看哪条线在往下长的，混进没人看过的候选会看不清
- 已确认的再确认一次不报错，保持幂等，不刷新时间
- 错误码继续用 20200 段

### 5.4 方向页

- 顶部一条横幅：「有 N 条 AI 新提的方向待确认」，点开展开待确认区
- 待确认区每条：可改显示名和说明、**采用**、**删除**
- 一键「全部采用」
- 树视图和状态分组**默认不含待确认的**，别污染演进树
- 各语言文案补齐（`de` / `en` / `fr` / `ja` / `ko` / `zh-CN` 六种；`zh` 目录只有两个命名空间，不是完整语种，不要往里加 `projects.json`）

## 六、验收

- [ ] 项目详情页右侧能开出对话面板，聊天、续聊、工具调用都正常
- [ ] 关掉面板再打开，上一条会话和消息都还在；任务跑到一半关掉再打开能接上
- [ ] 「新开一条」能开新会话，历史会话列表只显示当前项目的
- [ ] 读写文件显示成相对路径，TodoWrite 显示成会勾选的清单
- [ ] 「让 AI 提炼方向」不再弹窗，直接在当前对话里接着跑，并且吃到了前面聊的内容
- [ ] AI 提炼出来的方向不进树、不进状态分组，在待确认区里等着
- [ ] 采用之后才出现在树和分组里；删除能删掉
- [ ] 老会话、老方向行为不变
- [ ] 后端 `pnpm nx run aitoearn-server:build` 通过，网页 `npx tsc --noEmit` 通过
