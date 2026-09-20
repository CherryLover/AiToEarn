# settings API

## 模块边界

设置页里**按用户存在服务端**的配置。这一轮只有通知（Bark 推送地址、密钥、分组、总开关和通知规则），以及「发一条测试通知」。

个人资料（昵称、头像）走 `auth/`，外观（主题、语言）只存在浏览器本地，两者都不在本模块。

## 文件清单

- `notify.api.ts`
- `notify.types.ts`
- `notify.constants.ts`

## 接口清单

| 方法                    | 请求                         | 说明                                             |
| ----------------------- | ---------------------------- | ------------------------------------------------ |
| `getNotifySettingApi`   | `GET settings/notify`        | 读通知设置，barkKey 只回掩码。                   |
| `saveNotifySettingApi`  | `POST settings/notify`       | 保存通知设置，barkKey 传空串表示不改。           |
| `testNotifySettingApi`  | `POST settings/notify/test`  | 用**已保存**的配置真发一条测试通知，返回成败和原因码。 |

## 类型清单

| 名称                      | 类型        | 说明                                                 |
| ------------------------- | ----------- | ---------------------------------------------------- |
| `NotifyRule`              | `interface` | 一条通知规则：类型 + 开关。                          |
| `NotifyRuleType`          | `enum`      | 规则类型，目前只有 `draft_ready`（AI 生成素材结束）。|
| `NotifySetting`           | `interface` | 通知设置读取结果，含掩码、「已设置」标记和默认通道标记。|
| `NotifyTestFailure`       | `enum`      | 测试通知失败原因码，九种，逐个对应服务端。           |
| `NotifyTestResult`        | `interface` | 测试通知结果：`success` / `failure` / `status`。     |
| `SaveNotifySettingParams` | `interface` | 保存通知设置请求参数。                               |

## 常量清单

| 名称                              | 类型     | 说明                                     |
| --------------------------------- | -------- | ---------------------------------------- |
| `NOTIFY_BARK_BASE_URL_MAX_LENGTH` | `number` | Bark 地址长度上限（500，同服务端 DTO）。 |
| `NOTIFY_BARK_KEY_MAX_LENGTH`      | `number` | Bark key 长度上限（200，同服务端 DTO）。 |
| `NOTIFY_ERROR_CODE`               | `object` | 通知业务错误码（20600 段，逐个对齐）。   |
| `NOTIFY_GROUP_DEFAULT`            | `string` | 通知分组默认值 `AiToEarn`。              |
| `NOTIFY_GROUP_MAX_LENGTH`         | `number` | 通知分组长度上限（50，同服务端 DTO）。   |
| `NOTIFY_RULE_ORDER`               | `array`  | 规则在设置页里的展示顺序。               |

## 维护规则

- **字段名以服务端为准**（contract-settings 五点五节）。这里是手写声明，名字对不上 TypeScript 一个字都不会报，
  只会在用户眼前表现成「掩码永远不显示」「改个分组都被要求重输密钥」。改之前先读：
  - VO：`apps/aitoearn-server/src/core/settings/settings-notify.vo.ts`
  - DTO：同目录 `settings-notify.dto.ts`（长度上限也抄这里）
  - 错误码：`libs/common/src/enums/response-code.enum.ts` 的 20600 段
- **Bark 地址和 key 一律不进日志、不进埋点、不进 URL query。** 出错时只打错误码，不打这两个值。
- 读接口拿到的 `barkKeyMask` 只用来显示，**绝不能回填进输入框再提交**：用户没动密钥框就提交空串。
- 测试接口用的是**已保存的**配置，不是表单里的当前值——密钥永远不回传给前端，前端手里根本没有它。
- 规则是数组，不要在前端退化成一个布尔值；加规则时只往 `NotifyRuleType` 和 `NOTIFY_RULE_ORDER` 里追加。
- 地址合法性以服务端为准（服务端要挡内网、回环、云元数据地址）。前端的预校验只为即时提示，不能当成安全边界。
- 通用规则见 `src/api/README.md`。
