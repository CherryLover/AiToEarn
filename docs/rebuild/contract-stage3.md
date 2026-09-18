# 阶段 3 契约：执行端通道

> 前置：`contract-core.md`、`contract-skeleton.md`（**数据模型和协议全在骨架里，这份只讲怎么实现**）。
> 目标：网页上点一下，插件收到、执行、回报，网页看到结果。
> 注意：插件那一侧由另一条线做，本阶段只做服务端和网页。**服务端必须能独立验证**，不能依赖插件才能测。

## 任务划分

| Agent | 可碰文件范围 |
|---|---|
| **A · 设备与配对** | `libs/mongodb/src/schemas/device.schema.ts`、`repositories/device.repository.ts` 及两个 index、`apps/aitoearn-server/src/core/devices/`、`libs/common/src/enums/response-code.enum.ts`、`libs/common/src/i18n/messages.ts`、`app.module.ts`、`config.ts` |
| **B · 工单与 WebSocket** | `libs/mongodb/src/schemas/execution-task.schema.ts`、`repositories/execution-task.repository.ts`、`apps/aitoearn-server/src/core/execution-tasks/` |
| **C · 网页** | `src/api/devices/`、`src/api/README.md`、`src/app/[lng]/devices/`、`src/app/layout/routerData.tsx`、`src/app/i18n/locales/*/` |

A 和 B 会同时改 `schemas/index.ts`、`repositories/index.ts`、`response-code.enum.ts`、`messages.ts`、`app.module.ts` 这几个共享文件——**各自只加自己那几行，不要动别人的行**，加在各自的字母序位置。

## 一、Agent A：设备与配对

### 表与配对码

`device` 表照骨架第二节。配对码用 **Redis**（仓库已有 `@yikart/redis`），键 `device:pair:<code>`，TTL 10 分钟，值是 `userId`。

设备令牌照 `core/api-key` 的做法：生成明文 → 存哈希 → **明文只在配对成功时返回一次**。

### 接口

**管理侧** `@Controller('/devices')`，走网页登录：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/pairing-code` | 生成配对码，返回码和过期时间 |
| GET | `/list` | 设备列表，带在线状态 |
| POST | `/:id/update` | 改设备名 |
| DELETE | `/:id` | 吊销设备（令牌立即失效） |

**设备侧** `@Controller('/device-api')`，走设备令牌：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/pair` | 用配对码换设备令牌。**这一个不需要令牌** |
| POST | `/heartbeat` | 刷新 `lastSeenAt`，顺带上报能力和已登录账号 |

### 设备令牌认证

新写一个守卫，从 `Authorization: Bearer <token>` 取令牌 → 哈希 → 查 `device` → 挂到请求上。

**照 `core/api-key` 现有的认证做法写**，先去读它怎么做的，不要自己发明一套。

在线判定按骨架：`lastSeenAt` 在 `heartbeatSeconds * 3` 内算在线，**不要靠 WebSocket 连接状态判断**——浏览器休眠时连接会悄悄断掉。

配置项加 `device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 }`。

错误码 **20300 段**。

## 二、Agent B：工单与 WebSocket

### 表

`executionTask` 照骨架第一节，字段、枚举、状态机、租约语义一条不落。

### 领取必须是原子的

```ts
findOneAndUpdate(
  {
    status: PENDING, mode: AUTO, availableAt: { $lte: now },
    targetDeviceId: { $in: [null, 本设备id] },       // 没指定，或指定的就是我
    requiredCapability: { $in: [null, ...设备能力] }, // 不要求，或我正好有
  },
  { $set: { status: LEASED, deviceId: 本设备id, leaseId, leaseExpiresAt, startedAt } },
  { sort: { priority: 1, availableAt: 1 }, new: true },
)
```

**同一时刻只能有一个设备拿到同一个工单，靠这次原子更新保证，不要在应用层加锁。**

> 两个条件必须用 `$in: [null, ...]` 写在各自字段上。写成两个并列的 `$or` 是错的——同一个对象里后一个键会盖掉前一个。

### 接口

**设备侧** `@Controller('/device-api/tasks')`，走设备令牌：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/claim` | 领一个活。没有就返回空，不要报错 |
| POST | `/:id/renew` | 续租，必须带 `leaseId` |
| POST | `/:id/start` | 上报开始执行，`leased` → `running` |
| POST | `/:id/report` | 回报结果，必须带 `leaseId` 和 `{ success, result?, error? }` |

**`leaseId` 对不上一律拒绝**，这是不重复执行的根本保证。过期租约的迟到结果绝不能覆盖后来者的成果。

**管理侧** `@Controller('/execution-tasks')`，走网页登录：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list` | 列表，可按项目、类型、状态、设备筛 |
| GET | `/:id` | 详情，含载荷和结果 |
| POST | `/create-echo` | **建一个 echo 任务，打通用** |
| POST | `/:id/cancel` | 取消 |
| POST | `/:id/retry` | 失败的重新排队（`attempts` 归零） |

### 回收过期租约

照 `core/channels/publish/scheduler/publish.scheduler.ts` 的写法，用 `@Cron`，每 30 秒扫一遍：

- `status ∈ {LEASED, RUNNING}` 且 `leaseExpiresAt < now`
- `attempts + 1`；没超 `maxAttempts` 回 `PENDING` 并设 `availableAt = now + min(60 * 2^attempts, 1800)` 秒；超了转 `FAILED`

### WebSocket 网关

路径 `/ws/device`，协议照骨架第三节。**仓库现在没有任何 WebSocket 代码**，需要装 `@nestjs/websockets` + `@nestjs/platform-socket.io`（或原生 `ws`，二选一，选完在代码注释里说明理由）。

要点：
- 连接时从 `Authorization` 头取设备令牌鉴权，认证失败立即断开
- 连上后 10 秒内必须收到 `hello`，否则断开
- 有新任务入队时给**能干这活的在线设备**推 `task_available`（只带 `taskType`，不带 taskId、不带内容）
- 60 秒一次 `ping`，两次没 `pong` 断开
- **网关挂了不能影响 HTTP 领取**。WebSocket 只是催办，正确性由定时领取兜底

### 测试要求（重点）

插件还没有，所以**服务端必须能自己证明自己是对的**：

- 用 HTTP 直接模拟设备：配对 → 领取 → 续租 → 回报，整条走通
- **并发领取**：多个设备同时抢同一个工单，必须只有一个拿到
- **过期租约的迟到回报必须被拒**
- 租约超时回收 + 退避重试 + 重试用尽转失败
- `manual` 模式的任务不会被 claim 领走
- 能力不匹配的设备领不到需要该能力的活

错误码 **20400 段**。

## 三、Agent C：网页

新增「设备」页 `src/app/[lng]/devices/`，加进导航。

- 设备列表：名字、在线状态、最后心跳、插件版本、能干哪些平台、登录了哪些号
- 「添加设备」→ 弹出配对码 + 倒计时 + 一键复制，说清楚要去插件里填
- 每台设备能改名、能吊销（吊销要二次确认，说明吊销后该设备立即失效）
- 设备详情下面列它最近领过的工单：类型、状态、耗时、失败原因

另外做一个**工单列表**（可以放在设备页里做标签页）：按状态筛，能看载荷和结果，失败的能一键重试，还能**手动建一个 echo 任务**——这是打通链路时最直接的工具。

空状态引导要说清楚：设备是装在你电脑上的浏览器插件，它去后台领活干。

六种语言文案补齐。
