# 阶段 0 契约：地基

> 前置：先读 `contract-core.md`。
> 目标：能建项目、服务器上有对应目录、**重新部署一次目录还在**。

## 任务划分（三个 Agent，目录零重叠）

| Agent | 可碰文件范围 |
|---|---|
| **A · 部署** | `deploy/oci/docker-compose.yml`、`deploy/oci/deploy.sh`、`deploy/oci/overrides/server.yaml`、`deploy/oci/overrides/ai.yaml`、`deploy/oci/README.md` |
| **B · 服务端** | `project/aitoearn-backend/libs/mongodb/src/schemas/`、`libs/mongodb/src/repositories/`、`libs/common/src/enums/response-code.enum.ts`、`apps/aitoearn-server/src/core/projects/`、`apps/aitoearn-server/src/app.module.ts`、`apps/aitoearn-server/src/config.ts` |
| **C · 网页** | `project/aitoearn-web/src/api/projects/`、`src/api/README.md`、`src/app/[lng]/projects/` |

B 和 C 都只依赖本契约，不依赖对方的产出，可以完全并行。

---

## 一、Agent A：部署

### 1. 容器挂载

`deploy/oci/docker-compose.yml` 里给 **aitoearn-server** 和 **aitoearn-ai** 两个服务各加一条挂载：

```yaml
    volumes:
      - ./config/xxx.yaml:/app/config.yaml:ro   # 现有的，保留
      - ${DATA_DIR:?}/projects:/data/projects   # 新增，可读写
```

### 2. 建目录

`deploy/oci/deploy.sh` 的数据目录段（现为 `sudo mkdir -p "$DATA_DIR"/{mongodb/db,mongodb/configdb,redis,rustfs}`）加上 `projects`。

**属主必须让两个应用容器内的进程能读写。** 先查 `project/aitoearn-backend/apps/aitoearn-server/Dockerfile` 和 `aitoearn-ai/Dockerfile` 确认容器内以哪个 uid 运行，再决定 `chown` 成什么。照 rustfs 那行的注释风格写清楚原因。

### 3. 配置项

两个 overrides 文件各加：

```yaml
projects:
  root: /data/projects
```

### 4. 文档

`deploy/oci/README.md` 补一段：物料目录在哪、挂载关系、`DATA_DIR` 怎么设。

同时说明：`DATA_DIR` 默认值是 `/data/aitoearn`，若希望物料目录与 `docker-compose.yml` 同级，在服务器 `.env` 里把 `DATA_DIR` 指到 compose 所在目录下的 `data` 即可（例如 `/opt/stack/aitoearn/data`），**必须是绝对路径**，因为 `deploy.sh` 用它做 `mkdir`。

### 验证

`docker compose -f deploy/oci/docker-compose.yml config` 能解析通过（本地可用假 `.env` 跑）。不要真部署。

---

## 二、Agent B：服务端

### 1. 数据表 `project`

新建 `libs/mongodb/src/schemas/project.schema.ts`：

```ts
export enum ProjectStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}
```

集合名 `project`，继承 `WithTimestampSchema`，字段：

| 字段 | 类型 | 必填 | 索引 | 说明 |
|---|---|---|---|---|
| `userId` | string | 是 | 是 | 创建者 |
| `userType` | UserType | 是 | 是 | 默认 `UserType.User`，与现有表一致 |
| `name` | string | 是 | **唯一** | 英文名 = 目录名，创建后不可改 |
| `displayName` | string | 是 | 否 | 显示名，可中文可改 |
| `desc` | string | 否 | 否 | 一句话说明 |
| `audience` | string | 否 | 否 | 面向谁 |
| `goal` | string | 否 | 否 | 想达成什么 |
| `status` | ProjectStatus | 是 | 是 | 默认 `ACTIVE` |
| `dirName` | string | 是 | 否 | 磁盘上的实际目录名。正常等于 `name`，归档后变成 `_archived_<name>_<yyyyMMddHHmmss>` |
| `archivedAt` | Date | 否 | 否 | 归档时间 |

`name` 建**唯一索引**（全局唯一，不带 userId）。

注册到 `schemas/index.ts`。

### 2. Repository

`libs/mongodb/src/repositories/project.repository.ts`，继承 `BaseRepository<Project>`，加这几个方法：

- `getByName(name: string)`
- `listByUserId(userId: string, status?: ProjectStatus)`
- `existsByName(name: string): Promise<boolean>`

注册到 `repositories/index.ts`。

### 3. 错误码

`libs/common/src/enums/response-code.enum.ts` 新增（现有最大到 19001，重做从 20000 起）：

```
ProjectNotFound        = 20000
ProjectNameInvalid     = 20001   // 不符合命名规则
ProjectNameTaken       = 20002   // 已存在
ProjectNameReserved    = 20003   // 命中保留字
ProjectDirCreateFailed = 20004   // 目录创建失败
ProjectArchived        = 20005   // 已归档，不能操作
ProjectPathEscape      = 20006   // 路径越界（阶段 1 起用，先占位）
```

检查 `libs/common/src/i18n/` 下现有码是否配了文案，有则照做补上。

### 4. 配置

`apps/aitoearn-server/src/config.ts` 加：

```ts
export const projectsConfigSchema = z.object({
  root: z.string().default('/data/projects').describe('项目物料根目录（容器内路径）'),
}).default({ root: '/data/projects' })
```

并挂进总配置对象，键名 `projects`。

### 5. 业务模块

新建 `apps/aitoearn-server/src/core/projects/`，照 `core/api-key/` 的样子拆文件。

**目录创建逻辑**（放在 service 里，建议单独一个 `project-dir.service.ts`）：

创建项目时在 `<root>/<name>/` 下建出：

```
CLAUDE.md
background/product/
background/website/
background/feedback/
background/legal/
angles/
drafts/
media/
```

空目录各放一个 `.gitkeep`，保证目录真实存在。

`CLAUDE.md` 初始内容用这个模板（占位符替换成实际值，空字段写「（未填写）」）：

```markdown
# {displayName}

> 这是「{displayName}」项目的物料目录。你（AI Agent）的工作范围**仅限本目录**，不要访问目录以外的任何路径。

## 项目信息

- 英文名：{name}
- 说明：{desc}
- 面向谁：{audience}
- 想达成什么：{goal}

## 目录说明

- `background/` —— 背景物料，真实客观的材料。写内容前先来这里翻，不要凭空编造
  - `product/` 产品介绍、功能说明
  - `website/` 网站文案、页面抓取
  - `feedback/` 用户反馈、评论、差评
  - `legal/` 隐私条款、协议
- `angles/` —— 发布方向定义，一个方向一个文件
- `drafts/` —— 生成的待发内容
- `media/` —— 图片原件与说明文件

## 规矩

1. 事实只能来自 `background/`，缺材料就说缺，不要编
2. 生成的内容放 `drafts/`，同时记下用了哪些物料、哪个方向
3. 不要修改 `background/` 里的原始材料
```

**事务性要求**：目录建失败要把已建的部分清理掉并抛 `ProjectDirCreateFailed`；数据库写入失败也要把目录删掉。不要留下半成品。

**归档**：把目录 `rename` 成 `_archived_<name>_<yyyyMMddHHmmss>`，更新 `dirName`、`status`、`archivedAt`。不删文件。

### 6. 接口

`@Controller('/projects')`，全部需要登录（`@GetToken()`）。

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/projects/create` | `CreateProjectDto` | `ProjectDetailVo` |
| GET | `/projects/list` | query: `status?` | `ProjectListItemVo[]` |
| GET | `/projects/:id` | — | `ProjectDetailVo` |
| POST | `/projects/:id/update` | `UpdateProjectDto` | `ProjectDetailVo` |
| POST | `/projects/:id/archive` | — | `ProjectDetailVo` |
| GET | `/projects/suggest-name` | — | `SuggestNameVo` |

**DTO**

```ts
CreateProjectDtoSchema = z.object({
  name: z.string().describe('项目英文名，同时是目录名，创建后不可修改'),
  displayName: z.string().min(1).max(60).describe('显示名，可中文，可随时修改'),
  desc: z.string().max(500).optional().describe('一句话说明'),
  audience: z.string().max(200).optional().describe('面向谁'),
  goal: z.string().max(200).optional().describe('想达成什么'),
})

UpdateProjectDtoSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  desc: z.string().max(500).optional(),
  audience: z.string().max(200).optional(),
  goal: z.string().max(200).optional(),
})
```

`UpdateProjectDto` **不接受 `name`**。若请求里带了 `name`，忽略即可，不报错。

**VO**

```ts
ProjectDetailVoSchema = z.object({
  id: z.string(),
  name: z.string().describe('英文名/目录名'),
  displayName: z.string(),
  desc: z.string().nullable(),
  audience: z.string().nullable(),
  goal: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  dirName: z.string().describe('磁盘上的实际目录名'),
  archivedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

ProjectListItemVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  desc: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  createdAt: z.coerce.date(),
})

SuggestNameVoSchema = z.object({
  name: z.string().describe('一个当前可用的建议英文名'),
})
```

**`suggest-name` 的实现**：用「形容词-名词」这类可读组合随机拼（例如 `calm-otter`、`bright-maple`），查重后返回；连续 10 次撞名就在末尾加数字。不要返回 uuid 之类不可读的串。

**校验与错误**

- `name` 不符合 `contract-core.md` 第三节的正则 → `ProjectNameInvalid`
- 命中保留字 → `ProjectNameReserved`
- 已存在 → `ProjectNameTaken`
- 项目不存在或不属于当前用户 → `ProjectNotFound`
- 对已归档项目调用 update / archive → `ProjectArchived`

注册 `ProjectsModule` 到 `app.module.ts`。

### 7. 测试

照现有 `*.spec.ts` 的写法，至少覆盖：名字校验（合法、非法、保留字、重名）、目录创建与失败回滚、归档改名。

### 验证

`cd project/aitoearn-backend && pnpm nx run aitoearn-server:build` 通过。

---

## 三、Agent C：网页

### 1. 接口封装

新建 `project/aitoearn-web/src/api/projects/`，含 `project.api.ts`、`project.types.ts`、`README.md`，并在 `src/api/README.md` 的模块索引表加一行。

函数一一对应上面六个接口，类型严格照 VO 定义。请求用 `http`，路径不带前导斜杠，例如：

```ts
export function getProjectList(status?: ProjectStatus) {
  return http.get<ProjectListItem[]>('projects/list', { status })
}
```

### 2. 页面

`src/app/[lng]/projects/page.tsx` —— 项目列表：

- 卡片或表格列出项目：显示名（主）、英文名（次，等宽字体）、说明、创建时间
- 右上角「新建项目」按钮
- 空状态要有引导文案，不要只留一片空白
- 归档的项目默认不显示，提供一个切换看归档的入口

**新建项目对话框**：

- 显示名（必填）
- 英文名（必填）：**前端就要按正则实时校验并给出人话提示**，旁边一个「随机生成」按钮调 `suggest-name`
- 英文名输入框下方固定一行小字提示：**创建后不可修改，它同时是服务器上的目录名**
- 说明、面向谁、想达成什么（选填）
- 提交失败按错误码给出对应提示，不要把原始错误码甩给用户

**项目详情**：阶段 0 只做最简版 `src/app/[lng]/projects/[id]/page.tsx`，展示基本信息 + 可编辑显示名/说明/受众/目标 + 归档按钮。四个标签页（物料/生成/发布/数据）是阶段 1、2 的事，这里先留占位。

### 3. 导航

把「项目」加进现有导航。放在哪、怎么放，按现有布局组件的写法来，不要重做导航结构。

### 验证

`cd project/aitoearn-web && npx tsc --noEmit` 通过。

---

## 阶段 0 的最终验收（调度方执行，Agent 不做）

1. 三份改动合并，两端编译通过
2. 推主分支，等 GitHub Actions 出镜像
3. 服务器跑部署脚本
4. 网页上建一个项目，ssh 上去确认 `$DATA_DIR/projects/<名>/` 结构完整、`CLAUDE.md` 内容正确
5. **再跑一次部署脚本，确认目录和文件都还在** ← 这一条是阶段 0 的核心目的
6. 试一遍：重名被拒、非法名被拒、显示名可改、英文名改不了、归档后目录改名
