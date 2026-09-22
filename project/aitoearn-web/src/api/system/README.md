# system API

## 模块边界

**进站就绪检查**（`GET /system/readiness`），以及分步引导页写配置时对 `/config` 覆盖层接口的一层包装。

覆盖层接口本身归 `config-editor/` 维护，本模块**只调用、不改它**。配置管理页的读写、校验、重启仍然走 `config-editor/`。

## 文件清单

- `readiness.api.ts`
- `readiness.types.ts`
- `readiness.constants.ts`
- `runtime-config.api.ts`
- `runtime-config.types.ts`

## 接口清单

| 方法                        | 请求                                          | 说明                                                       |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `getSystemReadinessApi`     | `GET system/readiness`                        | 逐项返回就绪状态，要登录，服务端不抛异常。                  |
| `getRuntimeConfigApi`       | `GET config` / `GET ai/config`                | 读**合并后**的配置，外加 `overriddenPaths` / `protectedPaths`。|
| `saveRuntimeConfigApi`      | `PUT config` / `PUT ai/config`                | 整份提交，服务端只把与 base 的差异写进覆盖层。              |
| `restartRuntimeServiceApi`  | `POST config/restart` / `ai/config/restart`   | 重启服务；`agent` 段热生效，其余改完要重启。                |

## 类型清单

| 名称               | 类型        | 说明                                                   |
| ------------------ | ----------- | ------------------------------------------------------ |
| `ReadinessVo`      | `interface` | 就绪检查结果：`ready` + `items`。                      |
| `ReadinessItemVo`  | `interface` | 单项结果：`key` / `status` / `required` / `configPath` / `detail`。|
| `ReadinessItemKey` | `enum`      | 五个检查项的键。                                       |
| `ReadinessStatus`  | `enum`      | `ok` / `missing` / `error`。                            |
| `RuntimeConfigVo`  | `interface` | `ConfigEditorConfigVo` 加上覆盖层的两个可选字段。      |

## 常量清单

| 名称                              | 类型     | 说明                                           |
| --------------------------------- | -------- | ---------------------------------------------- |
| `PROTECTED_CONFIG_TOP_LEVEL_KEYS` | `array`  | 只能从部署环境改的顶层键（契约 3.3），本地兜底。|
| `CONFIG_OVERRIDE_ERROR_CODE`      | `object` | 覆盖层错误码（20700 段，逐个对齐）。            |
| `SYSTEM_READINESS_ERROR_CODE`     | `object` | 就绪检查错误码（20750 段，逐个对齐）。          |

## 维护规则

- **字段名以服务端为准**（contract-settings 五点五节）。`ReadinessVo` / `ReadinessItemVo` 抄的是契约 4.1 的 VO 定义，
  网页这边是手写声明，名字对不上 TypeScript 一个字都不会报，只会表现成「横幅永远不出现」。改名前先读服务端 VO。
- `detail` 是**不做 i18n** 的原文，服务端保证里面不含任何 Key。网页照原样显示，不要拿去拼串、写进 URL 或埋点。
- 就绪检查一律 `silent`：它是背景信息，失败不该在用户脸上弹红框，该说的话由横幅和引导页去说。
- `items[].status` 只有三种，不要在网页里造第四种；「跳过」是引导页自己的展示状态，不属于服务端。
- 单项探测失败回在 `items[].status`，不走错误码；20750 段说的是检查本身出错。
- 保存一律**整份提交**，diff 由服务端算（契约 3.4）。网页自己算 diff 会把用户没动过的字段冻结成覆盖值。
- 受保护顶层键以服务端 `protectedPaths` 为准，本地名单只是兜底。
- 通用规则见 `src/api/README.md`。
