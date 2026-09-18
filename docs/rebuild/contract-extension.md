# 执行端对接文档（给浏览器插件那条线）

> 服务端已实现并通过测试，**不需要等插件就能验证**。这份照实际代码写，不是照设计写。
> 配套读 `contract-skeleton.md`（数据模型和状态机）。本文件只讲插件怎么跟服务端说话。

## 一句话

插件是一台**执行机**：拿配对码换一个长期令牌，之后定时去领活、干完回报。服务端会用 WebSocket 催你，但那只是提速，**断了不影响正确性**。

## 零、两条腿，主次要分清

| | 干什么 | 断了会怎样 |
|---|---|---|
| **定时闹钟**（主力） | `chrome.alarms` 定时醒来，调一次 `claim` 看有没有活 | 这条断了才真出问题 |
| **WebSocket**（加速） | 收到 `task_available` 立刻去 `claim` | 只是变慢，不丢活 |

**先把定时那条做通再做 WebSocket。** 反过来做，很容易写出「WebSocket 一断就不干活了」的东西。

## 一、配对

### 1. 用户在网页上拿码

网页 → `POST /devices/pairing-code` → 得到 8 位码，10 分钟有效。用户把码贴进插件。

### 2. 插件换令牌

```
POST /device-api/pair        （这个接口不需要令牌）
```
```jsonc
{
  "code": "A7K2M9QP",              // 必填，不区分大小写
  "name": "家里的 Mac",             // 必填，1~60 字
  "version": "3.8.4",              // 选填，插件版本
  "platform": "macOS 15",          // 选填
  "capabilities": ["xhs"],         // 选填，你能干哪些平台
  "accounts": [                    // 选填，登录了哪些号
    { "platform": "xhs", "accountName": "小明", "accountId": "123" }
  ]
}
```
返回：
```jsonc
{ "device": { "id": "...", "name": "...", ... }, "token": "设备令牌明文" }
```

**令牌明文只在这里返回这一次，之后拿不回来。** 存进 `chrome.storage.local`，丢了只能让用户重新配对。

配对码用一次就作废。

### 3. 之后所有请求带上

```
Authorization: Bearer <设备令牌>
```

## 二、心跳

```
POST /device-api/heartbeat
```
```jsonc
{
  "status": "idle",                // idle / busy，只做展示
  "version": "3.8.4",              // 选填
  "platform": "macOS 15",          // 选填
  "capabilities": ["xhs"],         // 选填，传了就整份覆盖
  "accounts": [ ... ]              // 选填，传了就整份覆盖
}
```
返回里有 `heartbeatSeconds`，**按服务端给的间隔来**，别自己写死。

**在线状态是按心跳算的，不看 WebSocket 连着没有**——浏览器休眠时连接会悄悄断掉，但设备其实还在。所以心跳不能停。

## 三、领活、干活、交活

### 领活

```
POST /device-api/tasks/claim
```
没活就返回空，**这不是错误**，不要当异常处理、不要退避重试。

有活时返回：
```jsonc
{
  "id": "工单 ID",
  "type": "echo",                  // 见下面的类型表
  "projectId": "...",
  "payload": { ... },              // 按类型不同
  "leaseId": "租约 id",             // ★ 后面每一步都要带上它
  "leaseExpiresAt": "2026-09-18T..."
}
```

**`leaseId` 是这套东西的命根子。** 续租、上报、回报都要带，对不上一律被拒。这是「一个活不会被两台机器干两遍」的保证——你的租约过期后活会被别人领走，这时你迟到的回报会被拒掉，不会覆盖别人的成果。

### 上报开始

```
POST /device-api/tasks/:id/start   →  { "leaseId": "..." }
```

### 续租

活干得久就要续，否则租约过期活会被收走重派。

```
POST /device-api/tasks/:id/renew   →  { "leaseId": "..." }
```
**建议在租约剩一半时续。** 别等到快过期才续，网络抖一下就来不及了。

### 回报

```
POST /device-api/tasks/:id/report
```
```jsonc
{
  "leaseId": "...",
  "success": true,
  "result": { ... },               // 成功时填，格式按类型
  "error": "失败原因"               // 失败时填，会显示给用户看，写人话
}
```

失败会自动重试（默认最多 3 次），退避 `min(60 * 2^已试次数, 1800)` 秒。重试用尽转失败。

### 干到一半浏览器关了怎么办

不用管。租约到期服务端会自动回收重派。但**如果你能感知到中断，主动回报一次失败会更快**——不用等租约过期。

## 四、工单类型

| type | 干什么 | 现在能不能做 |
|---|---|---|
| `echo` | 把 payload 里的 message 原样返回 | **先做这个**，打通链路用 |
| `publish` | 发一条内容 | 阶段 4 |
| `claim_link` | 去平台列表页找回刚发的帖子链接 | 阶段 4 |
| `collect_metrics` | 查一条帖子的浏览量等数据 | 阶段 5 |

### echo（第一个要跑通的）

```jsonc
payload: { "message": "任意字符串" }
result:  { "message": "原样返回", "deviceTime": "2026-09-18T..." }
```

网页上「设备」页有个按钮能直接建 echo 工单，**联调时用它**。

### publish

```jsonc
payload: {
  "platform": "xhs",
  "accountId": "...",
  "draftPath": "drafts/2026-09-18-xxx",   // 仅供追溯
  "snapshot": {                            // ★ 发这一份，不要回头去读文件
    "title": "...", "body": "...",
    "topics": ["..."],
    "mediaUrls": ["https://..."]           // OSS 地址，直接下载
  }
}
result: { "platformPostId": "...", "postUrl": "https://..." }
```
**拿不到帖子 ID 或链接就留空**，不要编。服务端会另派一个 `claim_link` 工单去补。

### collect_metrics

```jsonc
result: {
  "views": 0, "likes": 0, "collects": 0, "comments": 0, "shares": 0,
  "collectedAt": "..."
}
```
**取不到的指标填 `null`，不要填 0 冒充。** 0 和「没取到」在数据分析里是两回事。

## 五、WebSocket

**路径**：`/ws/device`，裸 WebSocket（不是 socket.io）。

**鉴权两种都行**：
- `Authorization: Bearer <令牌>` 头
- 或子协议：`new WebSocket(url, ['bearer', '<设备令牌>'])`

浏览器的 `WebSocket` 构造器设不了请求头，**插件里用子协议那种**。

**连上后 10 秒内必须发 `hello`**，否则被断开。

插件 → 服务端：
```jsonc
{ "type": "hello", "version": "3.8.4", "capabilities": ["xhs"], "accounts": [...] }
{ "type": "heartbeat", "status": "idle" }
{ "type": "pong" }
```

服务端 → 插件：
```jsonc
{ "type": "task_available", "taskType": "publish" }   // 只是催办，不带 ID 不带内容
{ "type": "ping" }                                     // 收到就回 pong
```

收到 `task_available` 就去调 `claim`。**注意它不告诉你是哪个工单**——这是故意的，省掉一整套重连补发和去重的麻烦。

## 六、错误码

失败时 HTTP 状态是 200，body 里 `code` 非 0：

| 码 | 意思 | 你该怎么办 |
|---|---|---|
| 20300 | 配对码无效或过期 | 让用户回网页重新拿码 |
| 20301 | 配对码已用过 | 同上 |
| 20304 | 设备令牌无效 | 令牌坏了或设备被吊销，提示重新配对 |
| 20306 | 设备已吊销 | 停止一切请求，提示重新配对 |
| 20401 | 租约无效 | 这个活已经不是你的了，**直接丢掉，别重试** |
| 20402 | 租约已过期 | 同上 |
| 20403 | 状态不允许 | 工单已被取消或已完结，丢掉 |
| 20405 | 手动任务不可领取 | 不该发生，说明领取逻辑有问题 |
| 20406 | 能力不匹配 | 不该发生，同上 |

**20401 / 20402 拿到就丢活，不要重试。** 重试只会把别人正在干的活搞乱。

## 七、建议的实现顺序

1. **配对 + 心跳**——能在网页「设备」页看到自己上线
2. **定时领 echo 工单并回报**——闹钟醒来 → claim → 干 → report。这一步走通，整条链路就通了
3. **WebSocket 催办**——在已经能干活的基础上加速
4. 之后再接 publish / claim_link / collect_metrics

**第 2 步是分水岭。** 它一通，后面都是往里填具体平台动作。

## 八、服务端这边可以怎么配合

服务端已经能自己模拟设备走完整条链路（配对 → 领取 → 续租 → 上报 → 回报），测试里覆盖了并发领取、过期租约迟到回报被拒、超时回收退避、手动任务不被领走、能力不匹配领不到。

也就是说：**插件这边如果调不通，先怀疑插件，服务端这条路是验过的。** 但真发现服务端的问题，直接提，别绕。
