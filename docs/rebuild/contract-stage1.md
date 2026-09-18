# 阶段 1 契约：物料进得去，Agent 看得见

> 前置：先读 `contract-core.md` 和 `contract-stage0.md`（阶段 0 已上线，project 表、目录创建、路径校验都在）。
> 目标：往项目里丢几份真物料，问 Agent「这个项目有什么材料」，它自己逛一圈说清楚。

## 任务划分（三个 Agent，目录零重叠）

| Agent | 可碰文件范围 |
|---|---|
| **A · 服务端文件层** | `apps/aitoearn-server/src/core/projects/` 下全部、`libs/common/src/enums/response-code.enum.ts`、`libs/common/src/i18n/messages.ts`、`apps/aitoearn-server/src/config.ts` |
| **B · AI 服务** | `apps/aitoearn-ai/src/core/agent/` 下全部、`apps/aitoearn-ai/src/config.ts` |
| **C · 网页** | `project/aitoearn-web/src/api/projects/`、`src/app/[lng]/projects/`、`src/app/i18n/locales/*/projects.json` |

C 按本契约定义的接口写，不等 A 的产出。

---

## 一、Agent A：服务端文件层

### 1【必须第一件做】重做路径安全，不许再「先查后用」

`contract-core.md` 第四节记了阶段 0 留下的 TOCTOU 缺口：`resolveProjectPath` 校验通过后返回词法路径，调用方拿去 `writeFile` / `mkdir` 时不再校验，并发换软链就能写到根目录外面（已实测 4 次 4 中）。

阶段 0 经 HTTP 打不到，**但阶段 1 恰好把前提补齐**：这个任务要做的就是「按用户传来的路径读写文件」。所以这一条必须在任何文件接口上线之前完成。

要求：

- 写文件统一走 `open` 带 `O_NOFOLLOW`，最后一段是软链直接失败；新建文件叠 `O_EXCL`
- 拿到句柄之后基于句柄操作，不要拿着路径字符串二次访问
- 建目录逐级下钻，每级 `lstat` 确认不是软链
- 读文件同样带 `O_NOFOLLOW`
- 删除前 `lstat`，是软链就只删链接本身，绝不递归跟进去
- **所有文件接口一律不创建软链**，也不接受用户传来的软链路径
- 出错一律拒绝（fail closed）
- 阶段 0 已有的 23 种防护不能退化，合法场景（根目录本身是软链等）不能误伤

补对抗单测，至少覆盖：写入时最后一段被换成软链、建目录时中间层被换成软链、删除软链不跟进去。

### 2 文件管理接口

全部挂在 `@Controller('/projects')` 下，全部需要登录，全部先校验项目归属和未归档。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/projects/:id/files/tree` | 目录树。query：`path`（相对项目根，默认根）、`depth`（默认 3，最大 10） |
| GET | `/projects/:id/files/read` | 读文本。query：`path` |
| POST | `/projects/:id/files/write` | 写文本。body：`{ path, content }` |
| POST | `/projects/:id/files/mkdir` | 建文件夹。body：`{ path }` |
| POST | `/projects/:id/files/rename` | 改名/移动。body：`{ from, to }` |
| POST | `/projects/:id/files/delete` | 删除。body：`{ path }` |
| POST | `/projects/:id/files/upload` | 上传文件。multipart，字段 `file` + `path`（目标目录） |
| GET | `/projects/:id/files/download` | 下载原件。query：`path` |

**路径规则**（所有接口统一）

- 一律是相对项目根的路径，不接受绝对路径、不接受 `..`
- 不接受空路径段、NUL 字节、控制字符
- 单段长度 ≤ 255，总长 ≤ 1024

**大小与类型限制**

- `read` / `write` 只处理文本，单文件上限 1 MB，超了报错让走 download
- `read` 要先判断是不是文本（按扩展名白名单 + 内容嗅探），二进制直接拒绝并提示走 download
- `upload` 单文件上限 100 MB
- 不解压任何压缩包

**VO**

```ts
FileNodeVoSchema = z.object({
  name: z.string(),
  path: z.string().describe('相对项目根的路径'),
  type: z.enum(['dir', 'file']),
  size: z.number().nullable().describe('目录为 null'),
  updatedAt: z.coerce.date(),
  children: z.array(z.lazy(() => FileNodeVoSchema)).nullable().describe('未展开或非目录时为 null'),
})

FileContentVoSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  updatedAt: z.coerce.date(),
})
```

**新增错误码**（20100 段）

```
ProjectFileNotFound      = 20100
ProjectFilePathInvalid   = 20101
ProjectFileTooLarge      = 20102
ProjectFileNotText       = 20103
ProjectFileExists        = 20104
ProjectFileWriteFailed   = 20105
ProjectFileIsSymlink     = 20106   // 目标是软链，拒绝操作
ProjectFileUploadFailed  = 20107
```

i18n 六种语言都要补。

### 3 图片：原件落盘 + 传 OSS + 写名片

上传图片（`image/*`）时，一次做三件事：

1. 原件写进目标目录（通常是 `media/`）
2. 同一份传到 OSS，拿到公开 URL（复用现有 `@yikart/assets` 的上传能力，别自己写一套）
3. 在原件旁边写一个同名加 `.md` 的名片文件

名片文件格式：

```markdown
---
file: screenshot-home.png
type: image
oss: https://<oss域名>/<key>
size: 128394
width: 1920
height: 1080
uploadedAt: 2026-09-18T05:00:00Z
---

（这张图是什么，上传时留空。以后由能读图的模型补上，或由你手写。）
```

- 正文留空，**不要编造描述**
- 名片本身是文本文件，Agent `cat` 得到，`tree` 里也看得见
- 非图片文件不写名片
- OSS 上传失败不阻塞：原件已经落盘，名片里 `oss` 留空并记日志

### 4 验证

- `pnpm nx run aitoearn-server:build --skip-nx-cache`
- `cd apps/aitoearn-server && npx vitest run --config vitest.config.mts src/core/projects`
- 对改动文件跑 eslint

---

## 二、Agent B：AI 服务

目标：让服务端的 Agent 在指定项目的物料目录里干活，能自己逛、能读、能写，但出不去这个目录。

### 1 任务带上项目

`CreateContentGenerationTaskSchema`（`core/agent/agent.dto.ts`）加一个可选字段：

```ts
projectName: z.string().optional().describe('项目英文名（即目录名）。传了就在该项目的物料目录里工作')
```

**用名字不用 ID**，这样 AI 服务不需要去查 project 表。

AI 服务侧必须自己校验这个名字，不能信调用方：套用 `contract-core.md` 第三节的正则和保留字，不通过直接拒绝。归档目录名（`_archived_` 开头）也一律拒绝。

### 2 工作目录

`agent-runtime.service.ts` 里 `queryOptions.cwd` 现在是 `.claude-session/tasks/<taskId>`。改成：

- 带了 `projectName` → `cwd` = `<projects.root>/<projectName>`，且该目录必须已存在（不存在就报错，不要自己建）
- 没带 → 保持现状不变

`projects.root` 从 `apps/aitoearn-ai/src/config.ts` 的 `projects` 配置读（阶段 0 已加好）。

`settingSources` 已经含 `'project'`，项目目录里的 `CLAUDE.md` 会被自动读取——**不要再手工把项目说明拼进提示词**，重复了。

### 3 放开工具，同时焊好笼子

现在 `tools` 白名单只有 9 个：`Task` / `TaskOutput` / `Read` / `WebFetch` / `TodoWrite` / `TaskStop` / `Skill` / `ListMcpResourcesTool` / `ReadMcpResourceTool`。

**带 `projectName` 的任务**额外开放：`Glob`、`Grep`、`Write`、`Edit`。

**先不要开 `Bash`。** 理由写清楚：`Bash` 一开，路径校验就得去解析命令行才能拦住，可靠性无从保证；而用户要的「ls、cat、搜物料」用 `Glob` / `Grep` / `Read` 已经完全覆盖。等确有非开不可的需求再单独议。

**不带 `projectName` 的任务保持原样**，一个新工具都不加——不要影响现有的视频生成那条链路。

### 4 路径钩子

`queryOptions` 里已经有 `canUseTool` 钩子（约 292 行）。在里面加项目根校验：

- 对 `Read` / `Write` / `Edit` / `Glob` / `Grep` 的路径类入参，解析成绝对路径后必须落在项目根内
- 校验逻辑和 Agent A 那边同源：`lstat` 识别软链、跟到最终落点、跟不动就拒绝
- 拒绝时返回清楚的原因，让模型知道是越界了而不是文件不存在
- 没带 `projectName` 的任务不加这层限制（行为不变）

**这一层不是唯一防线**，另外两层是：容器里只挂了 `projects`（配置和 `.env` 根本不在容器里）、`cwd` 锁死在项目目录。三层都要在。

### 5 验证

- `pnpm nx run aitoearn-ai:build --skip-nx-cache`
- 补单测：名字校验、cwd 解析、越界路径被 `canUseTool` 拒绝、不带 `projectName` 时行为不变

---

## 三、Agent C：网页文件浏览器

### 1 接口封装

`src/api/projects/` 里加文件相关函数和类型，严格按上面的接口和 VO 定义。遵守 `src/api/README.md` 的目录规范。

### 2 项目详情页补「物料」标签页

阶段 0 留了四个标签页的占位，这次把第一个填上：

- **左边目录树**：可展开收起，能新建文件夹，能右键改名/删除（删除要二次确认）
- **右边内容区**：
  - 选中文本文件 → 显示内容，可编辑保存
  - 选中图片 → 显示图片（用名片里的 OSS 地址，没有就走 download 接口）
  - 选中其他二进制 → 显示文件信息和下载按钮
  - 没选中 → 显示这个项目的物料概览（各目录下有多少份材料）
- **上传**：支持拖拽和选择文件，能一次传多个，显示进度，传完刷新目录树
- 上传图片后要能看到旁边自动生成的名片文件

### 3 体验要求

- 空目录要有引导文案，直接说清楚这个目录该放什么（`background/product` 放产品介绍、`background/feedback` 放用户反馈，等等）
- 大文件上传要有进度和取消
- 保存失败要按错误码给人话提示
- 六种语言文案补齐

### 4 验证

`cd project/aitoearn-web && npx tsc --noEmit`

---

## 阶段 1 的最终验收（调度方执行）

1. 三份改动合并，两端编译通过，测试通过
2. 独立的对抗验证：专门试 TOCTOU 竞态和各种软链逃逸，确认打不穿
3. 部署上线
4. 网页上往一个真项目里丢几份真物料（一份产品介绍、一张截图、一份用户反馈）
5. 确认截图旁边自动生成了名片文件，里面有 OSS 地址
6. **让 Agent 带着 projectName 跑一个任务，问它「这个项目有什么材料」，它得自己逛一圈说清楚**
7. 再让它试着读项目目录外面的文件，确认被拒
