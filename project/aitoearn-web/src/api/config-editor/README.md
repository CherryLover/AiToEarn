# Config Editor API

配置管理接口模块，对接后端 `config-editor` 控制器。

## 文件清单

| 文件                     | 说明                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `config-editor.api.ts`   | 按服务目标获取配置、校验配置、保存配置、重启服务、恢复检查。 |
| `config-editor.types.ts` | 配置文件格式、服务目标、配置响应与请求类型。                 |

## 接口清单

| 方法                              | 路径                                          | 说明                                                           |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| `getConfigEditorConfigApi`        | `GET config` / `GET ai/config`                | 获取**合并后**的配置对象、文件格式，以及覆盖层与受保护键路径。 |
| `validateConfigEditorConfigApi`   | `POST config/validate` / `ai/config/validate` | 校验指定服务配置对象。                                         |
| `saveConfigEditorConfigApi`       | `PUT config` / `PUT ai/config`                | 保存配置：服务端只把与基础配置的差异写进运行时覆盖层。         |
| `restartConfigEditorServiceApi`   | `POST config/restart` / `ai/config/restart`   | 重启指定服务。                                                 |
| `checkConfigEditorConfigReadyApi` | `GET v2/channels/accounts` / `GET ai/config`  | 按服务目标确认服务接口是否恢复可用。                           |

## 维护规则

- 请求方法与类型定义保持分离。
- 配置编辑 UI 不直接调用 `fetch` 访问业务接口，统一通过本目录 API。
- 主服务重启后使用账号列表接口确认业务 API 恢复，避免轮询旧健康检查接口。
- AI 服务配置入口通过网关路径 `ai/config` 访问，重启后使用带鉴权的配置读取确认恢复。

## 运行时覆盖层字段

配置是分层的：`config.yaml`（`.env` 渲染出来的基石）叠上 `config.override.yaml`（运行时可改）。
`ConfigEditorConfigVo` 因此带两份键路径清单，**字段名照服务端 VO（`libs/config-editor/src/config-editor.vo.ts`）一字不差地抄，不要自己起名**：

| 字段              | 含义                                                   |
| ----------------- | ------------------------------------------------------ |
| `overriddenPaths` | 哪些键路径当前来自运行时覆盖层，形如 `agent.baseUrl`   |
| `protectedPaths`  | 顶层受保护键，只能从 `.env` 改，形如 `auth`、`mongodb` |

这两个字段在网页这边标成**可选**：老版本服务端不返回它们，调用方要当成空数组优雅退化，不能白屏。
受保护键被拒时服务端回 `ConfigOverrideProtectedKey`，`data.paths` 里逐个列出违规的键路径。
