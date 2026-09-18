# devices API

## 模块边界

执行端通道的管理侧接口：设备（浏览器插件）的配对码、列表、改名、吊销，以及执行工单（ExecutionTask）的列表、详情、取消、重试和手动建 echo 工单。设备侧接口（`device-api/*`）由浏览器插件调用，走设备令牌，不在本模块封装。

## 文件清单

- `device.api.ts`
- `device.types.ts`
- `device.constants.ts`
- `execution-task.api.ts`
- `execution-task.types.ts`
- `execution-task.constants.ts`

## 接口清单

| 方法                        | 请求                                | 说明                                   |
| --------------------------- | ----------------------------------- | -------------------------------------- |
| `cancelExecutionTaskApi`    | `POST execution-tasks/{id}/cancel`  | 取消工单。                             |
| `createDevicePairingCodeApi`| `POST devices/pairing-code`         | 生成配对码，填进插件完成配对。         |
| `createEchoTaskApi`         | `POST execution-tasks/create-echo`  | 手动建一个 echo 工单，验证链路。       |
| `getDeviceListApi`          | `GET devices/list`                  | 设备列表，带在线状态。                 |
| `getExecutionTaskDetailApi` | `GET execution-tasks/{id}`          | 工单详情，含载荷和结果。               |
| `getExecutionTaskListApi`   | `GET execution-tasks/list`          | 工单列表，可按项目、设备、类型、状态筛。|
| `retryExecutionTaskApi`     | `POST execution-tasks/{id}/retry`   | 失败工单重新排队，尝试次数归零。       |
| `revokeDeviceApi`           | `DELETE devices/{id}`               | 吊销设备，令牌立即失效。               |
| `updateDeviceApi`           | `POST devices/{id}/update`          | 改设备名。                             |

## 类型清单

| 名称                           | 类型        | 说明                                       |
| ------------------------------ | ----------- | ------------------------------------------ |
| `CreateEchoTaskParams`         | `interface` | 建 echo 工单请求参数。                     |
| `Device`                       | `interface` | 设备数据结构。                             |
| `DeviceAccount`                | `interface` | 设备上登录的平台账号。                     |
| `ExecutionTaskDetail`          | `interface` | 工单详情，含载荷、结果与租约到期时间。     |
| `ExecutionTaskListData`        | `interface` | 工单列表分页返回，对应服务端 ExecutionTaskListVo。|
| `ExecutionTaskListItem`        | `interface` | 工单列表项。                               |
| `ExecutionTaskMode`            | `enum`      | 执行方式：设备自动 / 人工。                |
| `ExecutionTaskStatus`          | `enum`      | 工单状态：待领取 / 已领取 / 执行中 / 成功 / 失败 / 已取消。|
| `ExecutionTaskType`            | `enum`      | 工单类型：发布 / 找链接 / 采数据 / echo。  |
| `GetExecutionTaskListParams`   | `interface` | 工单列表筛选参数。                         |
| `PairingCode`                  | `interface` | 配对码、过期时间与剩余秒数。               |
| `UpdateDeviceParams`           | `interface` | 改设备名请求参数。                         |

## 常量清单

| 名称                              | 类型     | 说明                                   |
| --------------------------------- | -------- | -------------------------------------- |
| `DEVICE_CAPABILITY_LABEL_KEYS`    | `object` | 已知能力到文案键的映射。               |
| `DEVICE_ERROR_CODE`               | `object` | 设备业务错误码（20300 段）。           |
| `DEVICE_HEARTBEAT_SECONDS`        | `number` | 心跳间隔秒数。                         |
| `DEVICE_NAME_MAX_LENGTH`          | `number` | 设备名最长长度。                       |
| `DEVICE_ONLINE_FACTOR`            | `number` | 在线判定倍数。                         |
| `DEVICE_PAIRING_CODE_LENGTH`      | `number` | 配对码位数。                           |
| `DEVICE_PAIRING_CODE_TTL_SECONDS` | `number` | 配对码有效期秒数。                     |
| `ECHO_MESSAGE_MAX_LENGTH`         | `number` | echo 工单文本上限。                    |
| `EXECUTION_TASK_ERROR_CODE`       | `object` | 工单业务错误码（20400 段）。           |
| `EXECUTION_TASK_LEASE_SECONDS`    | `number` | 默认租约时长秒数。                     |
| `EXECUTION_TASK_PAGE_SIZE`        | `number` | 工单列表默认每页条数。                 |

## 维护规则

- 明文设备令牌只在插件配对成功时返回一次，网页不保存、不展示、不重复获取。
- 在线状态一律用服务端返回的 `online`，不要在前端按 WebSocket 连接状态自己判断。
- 工单的 `targetDeviceId` 是「指定必须谁来干」，`deviceId` 是「现在或最近谁在干」，两者含义不同，不要合并。
- 工单载荷和结果是按类型变化的自由结构，前端只做原样展示，不做二次解析。
- 通用规则见 `src/api/README.md`。
