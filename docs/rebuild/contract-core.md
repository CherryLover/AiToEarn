# 通用契约（所有 Agent 必读）

## 一、代码范式：照抄仓库现有写法

### 后端新模块

放在 `project/aitoearn-backend/apps/aitoearn-server/src/core/<模块名>/`，文件按现有模块拆：

```
<名>.module.ts     @Module({controllers, providers, exports})
<名>.controller.ts @ApiTags + @Controller('/路径')
<名>.service.ts    业务逻辑
<名>.dto.ts        入参，zod + createZodDto
<名>.vo.ts         出参，zod + createZodDto
```

参照 `core/api-key/`，它是本仓库最干净的样板。

**Controller 写法**

```ts
@ApiTags('业务分组')
@Controller('/projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @ApiDoc({
    summary: '一句话说明',
    description: '可选补充',
    body: CreateProjectDto.schema,
    response: ProjectDetailVo,
  })
  @Post('/create')
  async create(
    @GetToken() token: TokenInfo,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectDetailVo> { ... }
}
```

- 当前登录用户从 `@GetToken() token: TokenInfo` 取，用 `token.id`
- ObjectId 路径参数用 `@Param('id', ParseObjectIdPipe)`
- 没有全局路由前缀。Controller 写 `/projects`，网页侧访问 `${NEXT_PUBLIC_API_URL}/projects/...`

**DTO / VO 写法**

一律 zod + `createZodDto`，每个字段必须 `.describe()`（Swagger 文档靠它）：

```ts
import { createZodDto } from '@yikart/common'
import { z } from 'zod'

const CreateProjectDtoSchema = z.object({
  name: z.string().describe('项目英文名，同时是目录名，创建后不可改'),
})
export class CreateProjectDto extends createZodDto(CreateProjectDtoSchema, 'CreateProjectDto') {}
```

VO 提供静态 `create()` 构造，Controller 里 `return XxxVo.create({...})`。

**注册模块**：加到 `apps/aitoearn-server/src/app.module.ts` 的 `imports`。

### 数据表

**Schema** 放 `project/aitoearn-backend/libs/mongodb/src/schemas/<名>.schema.ts`：

```ts
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'project' })
export class Project extends WithTimestampSchema {
  id: string

  @Prop({ required: true, index: true })
  userId: string

  @Prop({ required: true, index: true, default: UserType.User })
  userType: UserType
}
export const ProjectSchema = SchemaFactory.createForClass(Project)
```

- 继承 `WithTimestampSchema`（自带 createdAt / updatedAt）
- 必须在 `schemas/index.ts` 的 `schemas` 数组里注册，否则模型不会加载
- 枚举定义在同一个 schema 文件里导出

**Repository** 放 `libs/mongodb/src/repositories/<名>.repository.ts`，继承 `BaseRepository<T>`：

```ts
export class ProjectRepository extends BaseRepository<Project> {
  constructor(@InjectModel(Project.name) model: Model<Project>) {
    super(model)
  }
  // 只加本表特有的查询方法
}
```

必须在 `repositories/index.ts` 的 `repositories` 数组里注册。

`BaseRepository` 已有 `getById` / `create` / `find` / `findOne` / `updateById` / `deleteOne` / 分页等，别重复实现。

### 错误处理

统一用 `AppException` + `ResponseCode`：

```ts
import { AppException, ResponseCode } from '@yikart/common'
throw new AppException(ResponseCode.ProjectNotFound)
```

新错误码加在 `libs/common/src/enums/response-code.enum.ts`。现有已用到 19001，**重做相关的一律从 20000 起**。加完检查 `libs/common/src/i18n/` 下现有码是否配了文案，有的话照做。

### 网页

**接口封装**放 `project/aitoearn-web/src/api/<业务域>/`，严格遵守 `src/api/README.md`：

- `<域>.api.ts` 只放请求函数
- `<域>.types.ts` 放类型
- `<域>.constants.ts` 放常量
- 同目录必须写 `README.md`，并在 `src/api/README.md` 的模块索引表里加一行
- 请求用 `import http from '@/utils/request'`，路径不带前导斜杠：`http.get<ProjectListVo>('projects/list')`

**页面**放 `src/app/[lng]/<路由>/page.tsx`，交互逻辑拆到同目录组件。沿用现有页面的写法（Next.js App Router + Tailwind + shadcn），不要引入新 UI 库、新状态管理。

## 二、命名约定

| 对象 | 规则 | 例子 |
|---|---|---|
| Mongo 集合 | 小驼峰单数 | `project`、`projectAngle`、`agentTask`、`postMetric` |
| 接口路径 | 小写复数 + 动作 | `/projects/create`、`/projects/list` |
| 错误码 | 20000 起，按模块分段 | 项目 200xx、物料 201xx、方向 202xx |
| 项目英文名 | 见下 | `fortyweeks` |

## 三、项目英文名规则（重要，多处依赖）

项目英文名同时是**目录名**和**接口里的稳定标识**，因此：

- 正则：`^[a-z][a-z0-9-]{1,38}[a-z0-9]$`（3~40 字符，小写字母开头，只含小写字母、数字、连字符，不以连字符结尾）
- 不允许连续连字符 `--`
- 保留字拒绝：`archived`、`tmp`、`temp`、`system`、`config`、`node_modules`，以及任何以 `_` 或 `.` 开头的名字
- **全局唯一**（不是按用户唯一），因为目录是全局的
- **创建后永久不可修改**，任何更新接口都不接受这个字段

另有 `displayName` 显示名：可中文、可随时改、不参与任何路径计算。

## 四、物料目录规范

宿主机：`$DATA_DIR/projects/`（`$DATA_DIR` 已是本仓库既有约定，mongodb / redis / rustfs 都在它下面，值在服务器 `.env` 里）

容器内统一挂到 **`/data/projects`**，`aitoearn-server` 和 `aitoearn-ai` 两个容器都要挂，读写权限。

每个项目的目录结构：

```
/data/projects/<项目英文名>/
├── CLAUDE.md          # 项目说明，AI 服务的 Agent 会自动读取
├── background/        # 背景物料：真实、客观的材料
│   ├── product/       #   产品介绍、功能说明
│   ├── website/       #   网站文案、页面抓取
│   ├── feedback/      #   用户反馈、评论、差评
│   └── legal/         #   隐私条款、协议
├── angles/            # 发布方向定义，一个方向一个文件
├── drafts/            # AI 生成的待发内容（正文 + 血缘记录）
└── media/             # 图片原件 + 名片文件（本体同时传 OSS）
```

**归档**：项目不真删，目录改名为 `_archived_<原名>_<yyyyMMddHHmmss>`，数据库标记状态。

**硬隔离**：任何涉及物料路径的代码，都必须校验最终解析出的绝对路径仍在该项目目录内（先 `path.resolve`，再判断前缀，拒绝 `..`、符号链接逃逸、绝对路径注入）。这条是安全底线，不是可选项。

### 硬隔离的已知边界（阶段 1 开工前必须处理）

阶段 0 实现的 `resolveProjectPath` 已经挡住了这些（经对抗测试，23 种手法全拦，零误伤）：`..` 回退、绝对路径注入、已存在的软链指向外部、**悬空软链**（指向尚不存在的外部目标）、中间层目录是软链、软链套软链、软链成环、同前缀兄弟目录、NUL 字节、超长路径、把外部文件当目录用。

**但它有一个设计层的缺口：TOCTOU 竞态。**

`resolveProjectPath` 是「先查后用」——校验通过后返回的是没有折叠软链的词法路径，调用方拿着它去 `writeFile` / `mkdir` 时不会再校验一次。对抗测试实测 4 次 4 中：并发地反复把某个路径「删掉 ↔ 换成指向外部的软链」，就能让服务把自己生成的内容写到根目录之外。

前提是攻击方能在项目目录里并发创建软链。**阶段 0 通过 HTTP 做不到**（能进路径计算的只有被正则锁死的项目名），所以阶段 0 不阻塞。

**阶段 1 必须先处理这一条再放开文件能力**，因为阶段 1 要做两件事恰好把前提补齐：网页文件管理接口允许按路径写、AI Agent 拿到写文件和执行命令的工具。

处理方向（不是补丁能解决的，要改写入路径的设计）：

- 写入统一走 `open` 带 `O_NOFOLLOW`，最后一段是软链就直接失败；新建文件再叠 `O_EXCL`
- 不要「先查后用」，改成拿到句柄之后基于句柄操作
- 创建目录同理：逐级下钻，每级 `lstat` 确认不是软链
- 文件管理接口一律不创建软链，也不解析用户传来的软链

**另外要记住**：AI Agent 的隔离不能只靠这一层。Agent 一旦有执行命令的能力，它绕过应用层代码直接读文件是轻而易举的。真正的三层是：容器里只挂 `projects` 这一层（配置和 `.env` 根本不挂进去）、Agent 的工作目录锁死在项目目录、工具权限钩子做路径校验。应用层的 `resolveProjectPath` 是第四层，不是唯一一层。

## 五、文件与数据库的分界

定死哪边说了算，避免两边打架：

| 东西 | 谁说了算 |
|---|---|
| 背景物料、方向定义、草稿正文 | **文件系统** |
| 项目元信息、发布记录、执行工单、数据快照 | **数据库** |

草稿是交界地带：正文在文件里，「发到哪个号、什么时候发、发了没有」在数据库里，靠 id 关联。

推论：**不要把物料内容往 Mongo 里存一份**，也不要把项目元信息只写在文件里。

## 六、必须知道的三个现状坑

| # | 坑 | 影响 |
|---|---|---|
| 1 | AI 容器现在**没有任何数据挂载**，只挂了只读 config；`deploy.sh` 每次都 `rm --stop --force` 应用容器再重建 | 容器内产生的一切重新部署即消失。物料落盘前必须先把挂载做对 |
| 2 | AI 服务 Agent 的工具白名单只开了 9 个（Task / TaskOutput / Read / WebFetch / TodoWrite / TaskStop / Skill / ListMcpResources / ReadMcpResource），**没有列目录、搜索、写文件、执行命令** | 见 `apps/aitoearn-ai/src/core/agent/services/agent-runtime.service.ts`。阶段 1 要放开，但必须同时上路径校验 |
| 3 | 浏览器插件没有独立身份，token 读自网页 localStorage | 阶段 3 才处理，另一条线负责 |

## 七、验证要求

**Agent 自己必须做到的：**

- 后端改动：`cd project/aitoearn-backend && pnpm nx run aitoearn-server:build` 通过
- AI 服务改动：`cd project/aitoearn-backend && pnpm nx run aitoearn-ai:build` 通过
- 网页改动：`cd project/aitoearn-web && npx tsc --noEmit` 通过
- 有单测的模块照现有 `*.spec.ts` 的写法补上

**Agent 不要做的：**

- 不要 git commit、不要推分支
- 不要跑部署脚本、不要连服务器
- 不要碰 `deploy/` 以外的部署配置（除非任务明确分配）
- 不要改别的 Agent 负责的目录

汇报时说清楚：改了哪些文件、编译结果、契约里哪些地方和实际代码对不上。
