# angles API

## 模块边界

发布方向（Angle）的元信息与血统：列表、演进树、新建、修改、派生、删除。方向的写作指引存在服务端文件里（`angles/<slug>.md`），本模块只封装元信息接口，不读写文件内容。

草稿（`drafts/`）不在本模块：草稿正文和血缘都是文件，读写一律走 `projects/` 模块的物料文件接口。

AI 提炼方向只写文件、不写库，所以跑完 AI 任务必须调一次 `syncAnglesApi` 把新方向登记进来，否则列表里什么都不会出现。

登记进来的方向是**待确认**的（没有 `confirmedAt`），要人点了采用才进正式列表。手建和派生的方向服务端建的时候就写上确认时间，不用再确认一遍。演进树（`getAngleTreeApi`）只含已确认的。

## 文件清单

- `angle.api.ts`
- `angle.types.ts`
- `angle.constants.ts`

## 接口清单

| 方法             | 请求                                              | 说明                                       |
| ---------------- | ------------------------------------------------- | ------------------------------------------ |
| `confirmAngleApi` | `POST projects/{projectId}/angles/{angleId}/confirm` | 采用一条待确认的方向，幂等。            |
| `confirmAnglesApi`| `POST projects/{projectId}/angles/confirm`       | 批量采用，body `{ angleIds }`，幂等。      |
| `createAngleApi` | `POST projects/{projectId}/angles/create`         | 手建一个方向，同时写出方向文件。           |
| `deleteAngleApi` | `DELETE projects/{projectId}/angles/{angleId}`    | 删除方向，同时删掉方向文件。               |
| `deriveAngleApi` | `POST projects/{projectId}/angles/{angleId}/derive` | 从这个方向派生子方向，血统由服务端填。   |
| `getAngleListApi`| `GET projects/{projectId}/angles/list`            | 方向列表，可按状态和确认与否筛选。         |
| `getAngleTreeApi`| `GET projects/{projectId}/angles/tree`            | 服务端组装好的方向演进树，只含已确认的。   |
| `syncAnglesApi`  | `POST projects/{projectId}/angles/sync`           | 登记 AI 写出来的方向文件，返回登记后的全量方向。 |
| `updateAngleApi` | `POST projects/{projectId}/angles/{angleId}/update` | 改名字、说明、状态。                     |

## 类型清单

| 名称                 | 类型        | 说明                                   |
| -------------------- | ----------- | -------------------------------------- |
| `Angle`              | `interface` | 方向数据结构。                         |
| `AngleDeleted`       | `interface` | 删除接口返回。                         |
| `AngleListParams`    | `interface` | 列表查询参数。                         |
| `AngleSource`        | `enum`      | 方向来源：AI / 手建 / 派生。           |
| `AngleStatus`        | `enum`      | 方向状态：候选 / 测试中 / 有效 / 淘汰。|
| `AngleTreeNode`      | `interface` | 演进树节点，比方向多一个 children。    |
| `ConfirmAnglesParams`| `interface` | 批量采用请求参数。                     |
| `CreateAngleParams`  | `interface` | 新建方向请求参数。                     |
| `DeriveAngleParams`  | `interface` | 派生子方向请求参数。                   |
| `UpdateAngleParams`  | `interface` | 修改方向请求参数。                     |

## 常量清单

| 名称                         | 类型     | 说明                             |
| ---------------------------- | -------- | -------------------------------- |
| `ANGLE_DESC_MAX_LENGTH`      | `number` | 方向说明最长长度。               |
| `ANGLE_ERROR_CODE`           | `object` | 方向业务错误码（20200 段）。     |
| `ANGLE_NAME_MAX_LENGTH`      | `number` | 方向显示名最长长度。             |
| `ANGLE_SLUG_MAX_LENGTH`      | `number` | slug 最长长度。                  |
| `ANGLE_SLUG_MIN_LENGTH`      | `number` | slug 最短长度。                  |
| `ANGLE_SLUG_PATTERN`         | `RegExp` | slug 正则，规则同项目英文名。    |
| `ANGLE_SLUG_RESERVED_WORDS`  | `array`  | slug 保留字。                    |
| `ANGLE_STATUS_ORDER`         | `array`  | 状态展示顺序。                   |

## 维护规则

- slug 同时是文件名（`angles/<slug>.md`），命名规则与项目英文名一致；服务端允许改，但页面目前不提供改 slug 的入口。
- 血统只能通过 derive 产生，`create` 不接受 `parentAngleId`。
- `confirmedAt` 缺省即待确认；服务端用的是可选字段不是 `null`，别在页面里拿 `=== null` 判。存量数据由后端 `migrations/` 下的脚本补齐，前端不做判空兼容。
- 状态、来源、错误码与服务端契约一一对应，改动必须两端同步。
- 通用规则见 `src/api/README.md`。
