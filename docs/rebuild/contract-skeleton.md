# 共用骨架契约（阶段 2/3/4 都依赖，先读这份）

> 这份定死的是跨阶段共用的数据模型和协议。阶段 2、3、4 并行开发，全靠它对齐。
> **浏览器插件那条线也照这份实现执行端。**
> 契约与代码冲突时停下来提问，不要自己改契约。

## 零、命名避让（重要）

仓库里**已经有** `ContentGenerationTask`（AI 对话任务）和 `AgentTask*` 系列错误码（18101~18109），那是 AI 服务的东西，**跟执行端一点关系都没有**。

新的执行端工单一律叫 **ExecutionTask**，集合名 `executionTask`。不要叫 AgentTask，会撞。

## 一、执行工单 ExecutionTask

集合 `executionTask`，继承 `WithTimestampSchema`。

| 字段 | 类型 | 必填 | 索引 | 说明 |
|---|---|---|---|---|
| `userId` | string | 是 | 是 | |
| `userType` | UserType | 是 | 是 | 默认 `UserType.User` |
| `projectId` | string | 是 | 是 | 属于哪个项目 |
| `angleId` | string | 否 | 是 | 属于哪个发布方向，归因用 |
| `type` | ExecutionTaskType | 是 | 是 | 见下 |
| `mode` | ExecutionTaskMode | 是 | 是 | `auto` / `manual`，默认 `auto` |
| `status` | ExecutionTaskStatus | 是 | 是 | 见下 |
| `targetDeviceId` | string | 否 | 是 | **指定谁来干**；空表示任意合格设备 |
| `deviceId` | string | 否 | 是 | **当前持有者**，领取时写入，重排时清空 |
| `requiredCapability` | string | 否 | 是 | 干这活需要的能力，如 `xhs` |
| `payload` | Object | 是 | | 按 type 不同，见第四节 |
| `result` | Object | 否 | | 执行结果 |
| `error` | string | 否 | | 失败原因（给人看的） |
| `leaseId` | string | 否 | | 本次租约的唯一 id |
| `leaseExpiresAt` | Date | 否 | 是 | 租约到期时间 |
| `attempts` | number | 是 | | 已尝试次数，默认 0 |
| `maxAttempts` | number | 是 | | 默认 3 |
| `availableAt` | Date | 是 | 是 | 到点才可领取。排期和重试退避都用它 |
| `priority` | number | 是 | 是 | 越小越先，默认 100 |
| `startedAt` / `finishedAt` | Date | 否 | | |

```ts
export enum ExecutionTaskType {
  PUBLISH = 'publish',              // 发布一条内容
  CLAIM_LINK = 'claim_link',        // 去平台找回刚发的帖子链接
  COLLECT_METRICS = 'collect_metrics', // 采集某条帖子的数据
  ECHO = 'echo',                    // 打通用，原样返回
}

export enum ExecutionTaskMode {
  AUTO = 'auto',      // 设备自动执行
  MANUAL = 'manual',  // 内容打包给人，人去发完回来登记
}

export enum ExecutionTaskStatus {
  PENDING = 'pending',      // 待领取
  LEASED = 'leased',        // 已被某设备领走，租约有效
  RUNNING = 'running',      // 设备报告开始执行
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',        // 重试用尽
  CANCELLED = 'cancelled',  // 人工取消
}
```

### 状态怎么流转

```
                 ┌──────────────── 租约超时回收 ────────────────┐
                 ↓                                              │
pending ──领取──> leased ──上报开始──> running ──成功──> succeeded
   ↑                                      │
   └────── 失败且还有重试（退避后）────────┤
                                          └──失败且重试用尽──> failed
```

- `manual` 的任务**不进入领取流程**，停在 `pending`，由网页上人工回填结果后直接转 `succeeded`
- 任何状态都能被人工 `cancelled`

### 「指定设备」和「当前持有者」是两个字段

实现时发现契约原本只给一个 `deviceId` 不够用。

失败重排时必须把「当前持有者」清空，好让别的设备接手。可如果只有一个字段，清空的同时就把「这个活本来指定给谁」也清掉了；反过来不清空，一个本不限设备的活会被永久绑死在刚失败的那台机器上——那台机器要是掉线，这活就再也没人能干。

所以拆开：`targetDeviceId` 是意图，建单时写死、全程不变；`deviceId` 是现状，领取时写入、重排时清空。**领取的过滤条件看 `targetDeviceId`，不是 `deviceId`。**

### 租约怎么做（幂等的关键）

1. **领取是一次原子更新**：`findOneAndUpdate({ status: PENDING, mode: AUTO, availableAt: { $lte: now }, ...能力与设备匹配 }, { $set: { status: LEASED, deviceId, leaseId: 新生成, leaseExpiresAt: now + leaseSeconds } })`。同一时刻只有一个设备能拿到，靠数据库保证。
2. **默认租约 300 秒**，写成配置项 `executionTask.leaseSeconds`。
3. **续租**必须带 `leaseId`，对不上直接拒绝。
4. **回报结果必须带 `leaseId`**，对不上一律拒绝。这样过期租约的迟到结果不会覆盖后来者的成果——这是不重复执行的根本保证，比任何加锁都可靠。
5. **回收**：定时扫 `status ∈ {LEASED, RUNNING} 且 leaseExpiresAt < now`，`attempts + 1`；没超 `maxAttempts` 就回 `PENDING` 并设 `availableAt = now + 退避`，超了转 `FAILED`。
6. **退避**：`min(60 * 2^attempts, 1800)` 秒。

## 二、设备 Device

集合 `device`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `userId` / `userType` | | |
| `name` | string | 人起的名字，如「家里的 Mac」 |
| `tokenHash` | string | 长期设备令牌的哈希。明文只在配对成功时返回一次，做法照 `core/api-key` |
| `capabilities` | string[] | 能干什么，如 `['xhs','douyin','wechat_channels']` |
| `accounts` | Object[] | 登录了哪些号：`{ platform, accountName, accountId }` |
| `status` | `online` / `offline` | |
| `lastSeenAt` | Date | 心跳刷新 |
| `version` | string | 插件版本 |
| `platform` | string | 哪台机器，如 `macOS 15` |

**在线判定**：`lastSeenAt` 在 `heartbeatSeconds * 3` 之内算在线。不要靠 WebSocket 连接状态判断，连接会因为浏览器休眠悄悄断掉。

### 配对流程

1. 网页上点「添加设备」→ 服务端生成 **8 位配对码**（大写字母数字，去掉 `0O1I` 这类易混字符），存 **Redis**，TTL 10 分钟，键 `device:pair:<code>`，值是 `userId`
2. 你把码填进插件
3. 插件调 `POST /devices/pair`，带 `{ code, name, version, platform, capabilities }`
4. 服务端校验码、建设备、**返回一次明文设备令牌**，同时作废该码
5. 之后插件所有请求带 `Authorization: Bearer <设备令牌>`

用 Redis 不建表，省一套过期清理。仓库已经有 Redis。

## 三、WebSocket 协议

**只传信号，不传数据。** 任务内容一律走 HTTP 领取。

这么定的理由：WebSocket 断了只影响到达速度，不影响正确性（定时闹钟兜底照样领得到活）；协议简单到插件几行就能实现；不用处理重连补发、消息顺序、去重这一堆麻烦。

**路径**：`/ws/device`，连接时用 `Authorization` 头带设备令牌。

服务端 → 插件：
```json
{"type":"task_available","taskType":"publish"}
{"type":"ping"}
```
`task_available` 只是催办，**不带 taskId、不带内容**。插件收到后走 HTTP 领取。

插件 → 服务端：
```json
{"type":"hello","version":"3.8.4","capabilities":["xhs"],"accounts":[...]}
{"type":"heartbeat","status":"idle"}
{"type":"pong"}
```

- 连上后第一条必须是 `hello`，10 秒内不发就断开
- 心跳默认 30 秒一次，配置项 `device.heartbeatSeconds`
- 服务端 60 秒发一次 `ping`，两次没收到 `pong` 就断开

## 四、各类任务的载荷与结果

### publish

```jsonc
payload: {
  "platform": "xhs",
  "accountId": "...",              // 发到哪个号
  "draftPath": "drafts/2026-09-18-xhs-pain-point",  // 来源，仅供追溯
  "snapshot": {                     // 点「发布」那一刻的快照
    "title": "...",
    "body": "...",
    "topics": ["..."],
    "mediaUrls": ["https://..."]    // OSS 地址，插件直接下载
  }
}
result: {
  "platformPostId": "...",          // 拿不到就留空，交给 claim_link
  "postUrl": "https://..."          // 同上
}
```

**必须用快照，不能只放路径。** 草稿文件在任务排队期间可能被改，发出去的应该是你点发布那一刻的版本，否则排期发布会变成薛定谔的内容。

### claim_link

```jsonc
payload: {
  "platform": "xhs",
  "accountId": "...",
  "publishedPostId": "...",        // 对应的发布记录
  "publishedAt": "2026-09-18T..." , // 用来在列表里认哪条是它
  "titleHint": "..."                // 辅助匹配
}
result: { "platformPostId": "...", "postUrl": "https://..." }
```

### collect_metrics

```jsonc
payload: {
  "platform": "xhs",
  "accountId": "...",
  "publishedPostId": "...",
  "platformPostId": "...",
  "postUrl": "https://..."
}
result: {
  "views": 0, "likes": 0, "collects": 0, "comments": 0, "shares": 0,
  "collectedAt": "2026-09-18T..."
}
```
取不到的指标留 `null`，**不要填 0 冒充**。

### echo

```jsonc
payload: { "message": "任意字符串" }
result:  { "message": "原样返回", "deviceTime": "2026-09-18T..." }
```
只为打通链路用，别的什么都不做。

## 五、已发布帖子的身份（阶段 4/5 用，现在定死）

一条已发布的帖子由 **`platform` + `platformPostId`** 唯一确定，`postUrl` 是给人点的。

**发布状态和链接状态必须分开两个字段**：

```ts
publishStatus: 'pending' | 'publishing' | 'published' | 'failed'
linkStatus:    'none' | 'claimed' | 'claim_failed'
```

因为「发成功了但没抓到链接」是真实会发生的情况。合成一个字段就变成模糊地带——到底算成功还是失败？拆开之后，「没拿到链接」的那些能单独派 `claim_link` 任务去补，发布本身的成败不受影响。

## 六、手动发布也走工单（已定）

`mode = manual` 的发布任务：

- 不进领取流程，设备看不见它
- 网页上显示成「待你手动发布」，把标题、正文、话题、图片都打包好，一键复制、一键打开平台页
- 你发完回网页点一下，填进帖子链接，任务转 `succeeded`，同时写发布记录

这么定的理由：所有发布都有工单、都有记录、都能被阶段 5 统一统计。否则手动发的那些成了黑洞，数据回流缺一块。

代价是你发完得回来点一下。嫌麻烦随时可以改，改动只在网页侧。

## 七、错误码分段

| 段 | 归谁 |
|---|---|
| 20000~20099 | 项目（阶段 0，已用到 20007） |
| 20100~20199 | 物料文件（阶段 1，已用到 20107） |
| 20200~20299 | 发布方向 Angle（阶段 2） |
| 20300~20399 | 设备 Device（阶段 3） |
| 20400~20499 | 执行工单 ExecutionTask（阶段 3） |
| 20500~20599 | 发布与数据（阶段 4/5） |
