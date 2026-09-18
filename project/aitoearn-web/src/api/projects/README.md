# projects API

## 模块边界

项目（Project）元信息与项目物料文件：创建、列表、详情、更新、归档、英文名建议，以及物料目录的浏览、读写、上传与下载。物料内容本身存在服务端文件系统里，本模块只负责接口封装，不在前端缓存或二次加工。

## 文件清单

- `project.api.ts`
- `project.types.ts`
- `project.constants.ts`
- `project-file.api.ts`
- `project-file.types.ts`
- `project-file.constants.ts`

## 接口清单

| 方法                     | 请求                                | 说明                                   |
| ------------------------ | ----------------------------------- | -------------------------------------- |
| `archiveProjectApi`      | `POST projects/{id}/archive`        | 归档项目，目录改名不删文件。           |
| `createProjectApi`       | `POST projects/create`              | 创建项目并生成物料目录。               |
| `deleteProjectFileApi`   | `POST projects/{id}/files/delete`   | 删除物料文件或目录。                   |
| `downloadProjectFileApi` | `GET projects/{id}/files/download`  | 下载物料原件，返回 Blob。              |
| `getProjectDetailApi`    | `GET projects/{id}`                 | 项目详情。                             |
| `getProjectFileTreeApi`  | `GET projects/{id}/files/tree`      | 物料目录树，可指定起始路径与层数。     |
| `getProjectListApi`      | `GET projects/list`                 | 项目列表，可按状态筛选。               |
| `mkdirProjectFileApi`    | `POST projects/{id}/files/mkdir`    | 新建物料文件夹。                       |
| `readProjectFileApi`     | `GET projects/{id}/files/read`      | 读取文本物料。                         |
| `renameProjectFileApi`   | `POST projects/{id}/files/rename`   | 物料改名 / 移动。                      |
| `suggestProjectNameApi`  | `GET projects/suggest-name`         | 获取一个当前可用的建议英文名。         |
| `updateProjectApi`       | `POST projects/{id}/update`         | 更新显示名、说明、受众、目标。         |
| `uploadProjectFileApi`   | `POST projects/{id}/files/upload`   | 上传物料，带进度与取消。               |
| `writeProjectFileApi`    | `POST projects/{id}/files/write`    | 写入文本物料。                         |

## 类型清单

| 名称                       | 类型        | 说明                                      |
| -------------------------- | ----------- | ----------------------------------------- |
| `CreateProjectParams`      | `interface` | 创建项目请求参数。                        |
| `DeleteProjectFileParams`  | `interface` | 删除物料请求参数。                        |
| `FileContent`              | `interface` | 文本物料内容数据结构。                    |
| `FileNode`                 | `interface` | 物料目录树节点数据结构。                  |
| `MkdirProjectFileParams`   | `interface` | 新建文件夹请求参数。                      |
| `ProjectDetail`            | `interface` | 项目详情数据结构。                        |
| `ProjectFileApiResponse`   | `type`      | 物料上传接口响应包装。                    |
| `ProjectFileDeleted`       | `interface` | 删除接口返回，含已删除路径。              |
| `ProjectFileTreeParams`    | `interface` | 目录树请求参数。                          |
| `ProjectFileType`          | `enum`      | 物料节点类型：目录 / 文件。               |
| `ProjectListItem`          | `interface` | 项目列表项数据结构。                      |
| `ProjectStatus`            | `enum`      | 项目状态：进行中 / 已归档。               |
| `RenameProjectFileParams`  | `interface` | 改名 / 移动请求参数。                     |
| `SuggestName`              | `interface` | 建议英文名数据结构。                      |
| `UpdateProjectParams`      | `interface` | 更新项目请求参数，不含英文名。            |
| `UploadProjectFileOptions` | `interface` | 上传请求选项：目标目录、进度、取消。      |
| `WriteProjectFileParams`   | `interface` | 写入文本物料请求参数。                    |

## 常量清单

| 名称                                | 类型     | 说明                               |
| ----------------------------------- | -------- | ---------------------------------- |
| `PROJECT_AUDIENCE_MAX_LENGTH`       | `number` | 面向谁最长长度。                   |
| `PROJECT_DESC_MAX_LENGTH`           | `number` | 一句话说明最长长度。               |
| `PROJECT_DISPLAY_NAME_MAX_LENGTH`   | `number` | 显示名最长长度。                   |
| `PROJECT_ERROR_CODE`                | `object` | 项目业务错误码（20000 段）。       |
| `PROJECT_FILE_ERROR_CODE`           | `object` | 物料文件业务错误码（20100 段）。   |
| `PROJECT_FILE_IMAGE_EXTENSIONS`     | `array`  | 走图片预览的扩展名。               |
| `PROJECT_FILE_PATH_MAX_LENGTH`      | `number` | 物料路径总长上限。                 |
| `PROJECT_FILE_PLACEHOLDER_NAMES`    | `array`  | 不计入物料份数的占位文件。         |
| `PROJECT_FILE_SEGMENT_MAX_LENGTH`   | `number` | 单段路径长度上限。                 |
| `PROJECT_FILE_TEXT_EXTENSIONS`      | `array`  | 走文本读写的扩展名。               |
| `PROJECT_FILE_TEXT_MAX_SIZE`        | `number` | 文本读写单文件上限。               |
| `PROJECT_FILE_TREE_DEFAULT_DEPTH`   | `number` | 目录树默认层数。                   |
| `PROJECT_FILE_TREE_MAX_DEPTH`       | `number` | 目录树最大层数。                   |
| `PROJECT_FILE_UPLOAD_MAX_SIZE`      | `number` | 上传单文件上限。                   |
| `PROJECT_GOAL_MAX_LENGTH`           | `number` | 想达成什么最长长度。               |
| `PROJECT_MATERIAL_DIRS`             | `array`  | 标准物料目录与对应引导文案键。     |
| `PROJECT_MATERIAL_DIR_GUIDE_KEYS`   | `object` | 目录路径到引导文案键的映射。       |
| `PROJECT_NAME_MAX_LENGTH`           | `number` | 英文名最长长度。                   |
| `PROJECT_NAME_MIN_LENGTH`           | `number` | 英文名最短长度。                   |
| `PROJECT_NAME_PATTERN`              | `RegExp` | 英文名正则。                       |
| `PROJECT_NAME_RESERVED_WORDS`       | `array`  | 英文名保留字。                     |

## 维护规则

- 英文名 `name` 创建后永久不可修改，更新接口不接受该字段，前端也不要提供修改入口。
- 命名规则、保留字、错误码与服务端契约一一对应，改动必须两端同步。
- 物料路径一律是相对项目根的相对路径，前端不得拼绝对路径，也不得出现 `..`。
- 上传与下载不走统一 `http` 封装（要上传进度、要二进制），鉴权头必须和 `utils/request` 保持一致。
- 通用规则见 `src/api/README.md`。
