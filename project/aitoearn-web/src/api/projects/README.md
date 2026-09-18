# projects API

## 模块边界

项目（Project）元信息：创建、列表、详情、更新、归档与英文名建议。项目物料文件本身归后端文件系统管理，本模块只负责元信息接口。

## 文件清单

- `project.api.ts`
- `project.types.ts`
- `project.constants.ts`

## 接口清单

| 方法                    | 请求                          | 说明                           |
| ----------------------- | ----------------------------- | ------------------------------ |
| `archiveProjectApi`     | `POST projects/{id}/archive`  | 归档项目，目录改名不删文件。   |
| `createProjectApi`      | `POST projects/create`        | 创建项目并生成物料目录。       |
| `getProjectDetailApi`   | `GET projects/{id}`           | 项目详情。                     |
| `getProjectListApi`     | `GET projects/list`           | 项目列表，可按状态筛选。       |
| `suggestProjectNameApi` | `GET projects/suggest-name`   | 获取一个当前可用的建议英文名。 |
| `updateProjectApi`      | `POST projects/{id}/update`   | 更新显示名、说明、受众、目标。 |

## 类型清单

| 名称                   | 类型        | 说明                                      |
| ---------------------- | ----------- | ----------------------------------------- |
| `CreateProjectParams`  | `interface` | 创建项目请求参数。                        |
| `ProjectDetail`        | `interface` | 项目详情数据结构。                        |
| `ProjectListItem`      | `interface` | 项目列表项数据结构。                      |
| `ProjectStatus`        | `enum`      | 项目状态：进行中 / 已归档。               |
| `SuggestName`          | `interface` | 建议英文名数据结构。                      |
| `UpdateProjectParams`  | `interface` | 更新项目请求参数，不含英文名。            |

## 常量清单

| 名称                              | 类型     | 说明                             |
| --------------------------------- | -------- | -------------------------------- |
| `PROJECT_AUDIENCE_MAX_LENGTH`     | `number` | 面向谁最长长度。                 |
| `PROJECT_DESC_MAX_LENGTH`         | `number` | 一句话说明最长长度。             |
| `PROJECT_DISPLAY_NAME_MAX_LENGTH` | `number` | 显示名最长长度。                 |
| `PROJECT_ERROR_CODE`              | `object` | 项目业务错误码（20000 段）。     |
| `PROJECT_GOAL_MAX_LENGTH`         | `number` | 想达成什么最长长度。             |
| `PROJECT_NAME_MAX_LENGTH`         | `number` | 英文名最长长度。                 |
| `PROJECT_NAME_MIN_LENGTH`         | `number` | 英文名最短长度。                 |
| `PROJECT_NAME_PATTERN`            | `RegExp` | 英文名正则。                     |
| `PROJECT_NAME_RESERVED_WORDS`     | `array`  | 英文名保留字。                   |

## 维护规则

- 英文名 `name` 创建后永久不可修改，更新接口不接受该字段，前端也不要提供修改入口。
- 命名规则、保留字、错误码与服务端契约一一对应，改动必须两端同步。
- 通用规则见 `src/api/README.md`。
