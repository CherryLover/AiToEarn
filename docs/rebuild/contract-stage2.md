# 阶段 2 契约：发布方向与内容生成

> 前置：`contract-core.md`、`contract-skeleton.md`、阶段 0/1 已上线。
> 目标：从真实物料里生成一条能直接拿去发的小红书内容。

## 核心概念：方向是假设，不是分类

方向（Angle）不是预先定好的枚举，是**待验证的假设**。你指个大方向，或者让 AI 从物料里提炼候选；发出去看数据，好就沿这条线深入（派生一个子方向），差就淘汰换新的试。

**血统是关键**：有了「这个方向是从哪个方向长出来的」，才能画出方向演进树，一眼看出哪条线在长、哪条试两次就断了。

## 任务划分

| Agent | 可碰文件范围 |
|---|---|
| **A · 服务端** | `libs/mongodb/src/schemas/angle.schema.ts`、`repositories/angle.repository.ts` 及两个 index、`libs/common/src/enums/response-code.enum.ts`、`libs/common/src/i18n/messages.ts`、`apps/aitoearn-server/src/core/angles/`、`app.module.ts` |
| **B · AI 技能** | `apps/aitoearn-ai/src/core/agent/skills/extracting-angles/`、`skills/drafting-post/`、`skills` 注册处 |
| **C · 网页** | `src/api/angles/`、`src/api/README.md`、`src/app/[lng]/projects/[id]/components/AnglesTab/`、`DraftsTab/`、`src/app/i18n/locales/*/projects.json` |

## 一、Agent A：服务端

### 数据表 `angle`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `userId` / `userType` | | 是 | |
| `projectId` | string | 是 | 索引 |
| `slug` | string | 是 | 文件名用，项目内唯一。规则同项目英文名，但**允许修改**（改了要同步改文件名） |
| `name` | string | 是 | 显示名，可中文 |
| `desc` | string | 否 | 这个方向切什么痛点、什么噱头 |
| `source` | AngleSource | 是 | `ai` / `user` / `derived` |
| `parentAngleId` | string | 否 | **血统**：从哪个方向派生来的 |
| `status` | AngleStatus | 是 | `candidate` / `testing` / `effective` / `retired`，默认 `candidate` |
| `sourceAssetPaths` | string[] | 否 | AI 提炼时吃了哪些背景物料 |
| `promptSnapshot` | string | 否 | 提炼时用的提示词 |

```ts
export enum AngleSource { AI = 'ai', USER = 'user', DERIVED = 'derived' }
export enum AngleStatus { CANDIDATE = 'candidate', TESTING = 'testing', EFFECTIVE = 'effective', RETIRED = 'retired' }
```

战绩（名下帖子的数据汇总）**这一阶段不做**，阶段 5 再加，但要在设计上留好位置。

### 文件侧

每个方向在项目目录下对应 `angles/<slug>.md`：

```markdown
---
slug: pain-point
name: 痛点切入
source: ai
parent: null
status: candidate
---

（这个方向具体怎么写：切什么痛点、用什么噱头、什么语气、避开什么。）
```

**数据库存元信息与血统，文件存写作指引**（骨架第五节的分界原则）。文件读写一律走阶段 1 的 `safe-fs`，不要自己写文件操作。

### 接口

`@Controller('/projects/:projectId/angles')`，全部要登录、校验项目归属与未归档。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list` | 列表，query `status?` |
| POST | `/create` | 手建一个方向 |
| POST | `/:angleId/update` | 改名字、说明、状态 |
| POST | `/:angleId/derive` | 从这个方向派生一个子方向（`source=derived`，`parentAngleId` 自动填） |
| DELETE | `/:angleId` | 删除（同时删文件） |
| GET | `/tree` | 方向演进树：按 `parentAngleId` 组装成树返回 |
| POST | `/sync` | **登记 AI 写出来的方向文件**：扫 `angles/` 下的 `.md`，把还没入库的补进来（来源默认 `ai`，血统按 frontmatter 里的 parent 连，回填 `sourceAssetPaths`），已登记的不动，返回登记后的全量方向 |

`/sync` 是实现时补的：契约原来没写，但 AI 技能只写文件不写库，少了它提炼出来的方向永远进不了库，网页上点完「让 AI 提炼方向」列表还是空的。**AI 任务跑完，网页必须调一次 `/sync` 再刷列表。**

错误码用 **20200 段**，i18n 照仓库现状补 `en-US` / `zh-CN`。

## 二、Agent B：AI 技能

照 `apps/aitoearn-ai/src/core/agent/skills/` 下现有 13 个技能的写法，新增两个。**先读几个现有的 SKILL.md 摸清格式再写。**

### 技能一：`extracting-angles`（从物料里提炼候选方向）

- 触发：用户想知道这个项目能从哪些角度发内容
- 做什么：读 `background/` 下的物料 → 提炼 3~6 个候选方向，每个说清楚切什么痛点、什么噱头、面向谁 → 写进 `angles/<slug>.md`
- **铁律：事实只能来自 `background/`，缺材料就说缺，不许编**
- 已有方向要先读一遍，不要提重复的
- 输出时说明每个方向吃了哪些物料（写进 frontmatter 的来源字段，供服务端回填 `sourceAssetPaths`）

### 技能二：`drafting-post`（按方向生成一条内容）

- 输入：项目 + 一个方向 + 目标平台
- 做什么：读 `CLAUDE.md`（项目说明）→ 读 `angles/<slug>.md`（写作指引）→ 读相关 `background/` 物料 → 生成内容 → 写进 `drafts/`
- 草稿目录结构：

```
drafts/<yyyy-MM-dd>-<平台>-<方向slug>/
├── content.md     # 正文，frontmatter 放标题和话题
└── meta.json      # 血缘：projectName、angleSlug、platform、sourceAssetPaths、promptSnapshot、model、createdAt
```

- **平台是可选参数，技能里不许写死任何平台的数字。** 没指定平台就生成平台中立的内容，不要替用户按某个平台裁剪；指定了平台，限制去读服务端已有的平台元数据（`core/channels/platforms/` 下），技能文档只写「去哪儿查」。某个平台没定义某项限制的，就说没有已知限制，**不许编一个数字**
  > 这条是踩过坑才加的：契约初版拿小红书当例子写死了字数和话题上限，而用户根本没选平台；更糟的是那几个数字和服务端实际定义的对不上（服务端小红书话题上限是 5，契约写的 10）。抄一份数字到文档里，服务端一改这边就飘。
- 图片从 `media/` 里挑，用名片文件里的 OSS 地址
- **第二次以后的生成必须多吃一样东西：之前哪些方向数据好、好在哪。** 阶段 5 会把这个喂进来，现在技能文档里先把这段写好、留出位置，不然滚动测试滚不起来

两个技能都要能在**只有 `projectName` 的情况下工作**——阶段 1 已经把工作目录锁到项目目录了，技能里用相对路径即可。

## 三、Agent C：网页

项目详情页填两个标签页（阶段 0 留的占位）：

**「方向」标签页**
- 方向列表，按状态分组（候选 / 测试中 / 有效 / 已淘汰）
- 有血统的画成树，一眼看出哪条线在往下长
- 每个方向能改状态、能「从这个方向深入」（调 derive）
- 一个「让 AI 提炼方向」的入口，调 AI 任务并带上 `projectName`
- 空状态引导：说清楚方向是拿来试的，不是一开始就要定死的

**「生成」标签页**
- 选方向 + 选平台 → 生成
- 草稿列表，点开看正文、看配图、看血缘（用了哪些物料、哪个方向、什么提示词）
- 草稿可编辑保存（写回 `drafts/<slug>/content.md`，走阶段 1 的文件接口）

六种语言文案补齐。
