# publishing API

## 模块边界

发布登记（PublishedPost）：从草稿建手动发布工单、发布记录列表与详情、人工回填帖子链接、人工标记发失败、删除登记。

**本模块不做真实发布。** 内容只打包给人看，人自己去平台发完再回来登记，所以这里没有、也不允许新增任何调用平台发布接口的方法。自动发布属于浏览器插件那条线，走执行工单（`devices/execution-task.api.ts`），不在本模块。

草稿正文和配图是文件，读写走 `projects/` 模块的物料文件接口；发布记录是数据库记录，只走本模块。

## 文件清单

- `publishing.api.ts`
- `publishing.types.ts`
- `publishing.constants.ts`

## 接口清单

| 方法                         | 请求                                             | 说明                                                       |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| `completePublishedPostApi`   | `POST projects/{projectId}/publishing/{id}/complete` | 回填帖子链接，记录转 published + claimed，工单转 succeeded。 |
| `createPublishFromDraftApi`  | `POST projects/{projectId}/publishing/from-draft` | 从草稿建手动发布工单，返回记录和没能进快照的图片。         |
| `deletePublishedPostApi`     | `DELETE projects/{projectId}/publishing/{id}`     | 删掉这条登记，不碰草稿文件。                               |
| `failPublishedPostApi`       | `POST projects/{projectId}/publishing/{id}/fail`  | 人工标记发失败，填原因。                                   |
| `getPublishedPostDetailApi`  | `GET projects/{projectId}/publishing/{id}`        | 发布记录详情，含完整内容快照。                             |
| `getPublishedPostListApi`    | `GET projects/{projectId}/publishing/list`        | 发布记录列表，可按状态筛。                                 |

## 类型清单

| 名称                          | 类型        | 说明                                           |
| ----------------------------- | ----------- | ---------------------------------------------- |
| `CompletePublishedPostParams` | `interface` | 回填链接请求参数。                             |
| `CreateFromDraftParams`       | `interface` | 从草稿建工单请求参数，`mode` 只能是 `manual`。 |
| `FailPublishedPostParams`     | `interface` | 标记发失败请求参数。                           |
| `GetPublishedPostListParams`  | `interface` | 列表筛选与分页参数。                           |
| `LinkStatus`                  | `enum`      | 链接状态：没有 / 已拿到 / 找链接失败。         |
| `PublishJobCreated`           | `interface` | 建工单返回：记录本体 + 被跳过的图片。          |
| `PublishSnapshot`             | `interface` | 点「准备发布」那一刻的内容快照。               |
| `PublishStatus`               | `enum`      | 发布状态：待发 / 发布中 / 已发 / 失败。        |
| `PublishedPostDeleted`        | `interface` | 删除接口返回，含一并删掉的工单 id。            |
| `PublishedPostDetail`         | `interface` | 发布记录详情，含完整快照。                     |
| `PublishedPostListData`       | `interface` | 列表分页返回。                                 |
| `PublishedPostListItem`       | `interface` | 发布记录列表项，带快照标题和图片张数。         |
| `SkippedMedia`                | `interface` | 没能进快照的图片及原因。                       |

## 常量清单

| 名称                              | 类型     | 说明                                     |
| --------------------------------- | -------- | ---------------------------------------- |
| `PLATFORM_POST_ID_MAX_LENGTH`     | `number` | 平台侧帖子 id 长度上限。                 |
| `POST_URL_MAX_LENGTH`             | `number` | 帖子链接长度上限。                       |
| `PUBLISHED_POST_PAGE_SIZE`        | `number` | 列表默认每页条数。                       |
| `PUBLISHING_ERROR_CODE`           | `object` | 发布业务错误码（20500 段）。             |
| `PUBLISH_DRAFT_PATH_MAX_LENGTH`   | `number` | 草稿路径长度上限。                       |
| `PUBLISH_FAIL_REASON_MAX_LENGTH`  | `number` | 发失败原因长度上限。                     |
| `PUBLISH_MODE_MANUAL`             | `const`  | 唯一允许的发布方式：手动。               |

## 维护规则

- 发布状态（`publishStatus`）和链接状态（`linkStatus`）是两个维度，「发成功了但没拿到链接」是真实情况，任何地方都不要合成一个字段展示。
- 卡片上给人复制的内容一律来自 `snapshot`，不要回头去读草稿文件：草稿在这之后可能已经被改过。
- 一条帖子由 `platform` + `platformPostId` 唯一确定，重复登记由服务端唯一索引兜底，前端只负责把错误翻成人话。
- 列表项自带 `title` 和 `mediaCount`，列表页不要为了显示标题再去拉详情。
- 平台创作后台地址是给人点开用的链接常量，放在页面侧 `PublishTab/publish.constants.ts`，不属于接口封装。
- 通用规则见 `src/api/README.md`。
