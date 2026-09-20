# 采集小红书创作平台数据

> 前置：`contract-skeleton.md`（工单模型）、`contract-extension.md`（插件对接）。
> **这份是拿真页面跑过一遍之后写的，不是设计推演。** 下面的事实都实测过。

## 零、实测结论（决定了整个设计）

在用户自己的 Chrome 里打开 `https://creator.xiaohongshu.com/new/note-manager` 跑了一遍：

| 实测发现 | 对设计的影响 |
|---|---|
| **没有帖子 ID**。整张卡片没有链接、没有任何带 ID 的属性，卡片本身不可点 | 唯一标识只能是**标题 + 发布时间**。骨架契约里「第一次采集抓 ID、之后按 ID 匹配」的方案在小红书走不通 |
| **接口要签名**。列表接口是 `/api/galaxy/v2/creator/note/user/posted`（参数只有 `tab`、`page`），带 cookie 直接调返回 **HTTP 406 / code -1** | 走接口这条路不通。要么复刻签名，要么把 cookie 发给外部签名服务（**后者禁止**，是还原报告里点名要改掉的做法）。**只能读 DOM** |
| **图标顺序是 浏览 / 评论 / 点赞 / 收藏 / 分享** | **不是直觉的「浏览、点赞、评论」**。按位置读会把赞和评论对调，而且不报错、数字照样有，全错 |
| 选择器很干净：`.note-card` > `.note-card__title` / `.note-card__time` / `.note-card__stat` × 5 | 好抓，但类名是 Vue 编译产物，改版会变 |
| **只加载 20 条，标签页写着「全部 65」**，没有分页控件，是内层容器懒加载 | 必须滚动加载到底，还要判断「到底了」 |
| **页面很重**。滚到底等 2.5 秒，渲染进程 45 秒超时没响应 | 给足超时，失败要能重试，别按秒级返回设计 |

实测到的数据（2026-09-20）：

| 标题 | 发布时间 | 浏览 | 评论 | 点赞 | 收藏 | 分享 |
|---|---|---|---|---|---|---|
| 结婚 4 年生出来个这…… | 2026-09-18 08:28 | 3030 | 9 | 1 | 0 | 0 |
| 做了个按孕周排的孕期日历，求孕妈们挑刺 | 2026-09-17 11:24 | 717 | 3 | 4 | 3 | 2 |
| 备孕刷到太多攻略，干脆自己做了个App | 2026-09-17 15:56 | 99 | 3 | 3 | 1 | 1 |

## 一、新工单类型 `sync_creator_notes`

骨架契约里的 `collect_metrics` 是「按帖子逐条采」，实测证明那个模型不成立——小红书没有可寻址的单帖入口，而且一次列表页就能拿到全部。

**改成：一个工单 = 一个平台 + 一个账号 = 把整张列表读回来。**

`collect_metrics` 保留定义但暂不实现，将来别的平台如果真能按帖子采再说。

### 载荷

```jsonc
{
  "platform": "xhs",
  "accountId": "...",                    // 可选，多号时区分
  "entryUrl": "https://creator.xiaohongshu.com/new/note-manager",
  "spec": {                              // 采集规格，见第二节
    "cardSelector": ".note-card",
    "titleSelector": ".note-card__title",
    "timeSelector": ".note-card__time",
    "statSelector": ".note-card__stat",
    "metricByIconPrefix": {
      "M7.99902 3.83398":  "views",
      "M3.18233 10.985":   "comments",
      "M3.25611 3.91336":  "likes",
      "M10.8848 14.2322":  "collects",
      "M8.28672 5.15797":  "shares"
    },
    "totalCountPattern": "^全部\\s*(\\d+)$",
    "maxScrolls": 40,
    "scrollSettleMs": 1500
  }
}
```

**规格放载荷里、不写死在插件里**，理由：平台改版时改服务端配置就行，不用发插件新版本。

**但这不是「远程自动化」那个洞**，两条硬约束：

1. **规格里只有选择器和正则，没有任何可执行代码。插件绝不 `eval`、绝不注入来自服务端的脚本。**
2. **插件侧有域名白名单**：内置 `{ xhs: ['creator.xiaohongshu.com'] }` 之类的表，`entryUrl` 的 host 不在对应平台的白名单里就拒绝执行、回报失败。

### 结果

```jsonc
{
  "collectedAt": "2026-09-20T06:12:00.000Z",
  "platform": "xhs",
  "accountHint": "程序杂念",          // 页面上能读到的账号名，对不对得上由服务端判断
  "totalClaimed": 65,                 // 页面标签页声称的总数
  "loadedCount": 65,                  // 实际加载到的卡片数
  "reachedEnd": true,                 // 是否确认滚到底
  "notes": [
    {
      "title": "结婚 4 年生出来个这……",
      "titleTruncated": false,        // 卡片上的标题是否被平台截断
      "publishedAtText": "2026-09-18 08:28",   // 原样字符串，不要在插件里转时区
      "metrics": { "views": 3030, "comments": 9, "likes": 1, "collects": 0, "shares": 0 }
    }
  ],
  "unrecognized": [                   // 图标指纹认不出来的，不猜
    { "title": "...", "publishedAtText": "...", "rawNumbers": ["12","3"], "unknownPrefixes": ["M1.234..."] }
  ],
  "warnings": ["滚动 40 次后仍在加载，可能没到底"]
}
```

## 二、插件侧怎么做

在 `src/device/jobs.ts` 的处理器表里加一个 `sync_creator_notes`。

### 流程

1. **校验白名单**：`entryUrl` 的 host 不在该平台的白名单里 → 直接失败，错误写「地址不在允许的域名里」
2. **开一个托管窗口**打开 `entryUrl`（沿用现有定时任务那套：钉住 windowId、跑完关掉，不抢用户正在用的窗口）
3. **等列表出现**：轮询 `cardSelector` 有没有元素，超时 60 秒
4. **滚动加载到底**：
   - 页面 body 不滚，是**内层容器**在滚。先从任意一张卡往上找最近的可滚动祖先（`scrollHeight > clientHeight` 且 `overflow` 是 `auto`/`scroll`）
   - 每次滚到底 → 等 `scrollSettleMs` → 看卡片数有没有变
   - 连续 2 次没变 → 认为到底，`reachedEnd: true`
   - 超过 `maxScrolls` 仍在变 → 停下，`reachedEnd: false` + warning
5. **逐卡提取**，见下
6. **回报**

### 提取每张卡（关键，别写错）

```
标题     cardSelector 内 titleSelector 的 textContent.trim()
发布时间  timeSelector 的 textContent.trim()，原样字符串回传
五个数字  statSelector 的每个元素：
           取它内部 svg 的第一个 path 的 d 属性
           拿 d 的前若干字符去 metricByIconPrefix 里找
           找到 → 这个数字就是那个指标
           找不到 → 整张卡进 unrecognized，不要猜
```

**死规矩：按图标认，绝对不按位置认。** 实测顺序是「浏览、评论、点赞、收藏、分享」，和直觉相反；按位置读会把赞和评论对调，而且不报错、数字照样有。

官方插件有过一模一样的教训：AI 评论小红书的校验用了抖音的选择器，取到空文字，**永远判成功**。

**数字解析**：可能出现「1.2万」这类缩写，要转成数字；转不了的整张卡进 `unrecognized`。

**标题截断**：卡片上的标题可能被平台截断。判断末尾是不是 `…`／`...`，是就置 `titleTruncated: true`。（实测那条「结婚 4 年生出来个这……」的省略号是标题本身自带的，不是截断——所以**不能只看有没有省略号就判定截断**，要比对 CSS 是否 `text-overflow: ellipsis` 且 `scrollWidth > clientWidth`。）

### 超时与失败

- 整个工单给 **180 秒**，别按秒级设计（实测滚动一次就把渲染进程卡到 45 秒超时）
- 干得久要**续租**，按对接文档「租约剩一半时续」
- 失败回报要说人话：「没登录」「列表没出现」「域名不在白名单」「滚动超上限」分开报，别都塞成「采集失败」
- **一条都没读到时必须判失败**，不能回报一个空数组当成功——空数据比报错难查十倍

### 怎么自测

不联后台也能测：在侧边栏做一个「本地试跑」入口，手填 `entryUrl` 和 spec，跑完把结果打在界面上。链路通了再接工单。

## 三、服务端怎么做

### 新表 `creatorNoteRow`（落地表）

插件回报的每一行原样落一条，**先存下来再谈匹配**。匹配逻辑将来会改，原始数据不能丢。

| 字段 | 说明 |
|---|---|
| `userId` / `userType` | |
| `platform` / `accountId` | |
| `title` / `titleTruncated` / `publishedAtText` | 原样 |
| `publishedAt` | 服务端按平台时区解析出来的时间，解析失败留空 |
| `metrics` | views / comments / likes / collects / shares |
| `collectedAt` | 采集时刻 |
| `executionTaskId` | 哪个工单采的 |
| `matchedPublishedPostId` | 匹配上了就填，没匹配上留空 |
| `matchState` | `matched` / `unmatched` / `ambiguous` |

`(platform, title, publishedAtText, collectedAt)` 建唯一索引，防同一次采集重复落。

### 匹配规则

按顺序试，**第一条命中就停**：

1. **已知帖子**：在 `publishedPost` 里按 `(platform, snapshot.title, publishedAt 同一分钟)` 找。命中 → `matched`，写一条 `postMetric` 快照
2. **草稿标题**：在所有项目的 `drafts/` 里找标题一致的草稿。命中 → **自动建一条 `publishedPost`**（`source: 'discovered'`，项目和方向从草稿的血缘里取），再写快照
3. **都没命中** → `unmatched`，数据照样存着，网页上列出来供人认领

第 2 条是这套方案能**全自动**的关键：用户手工发的帖子，草稿还在项目目录里，标题能对上，就能自动归到正确的项目和方向上。

**标题被截断时**：用前缀匹配（卡片标题去掉末尾省略号后做前缀比对）。前缀匹配到多于一条 → `ambiguous`，**数据照样存，标记出来**，不要猜也不要丢。

### 为什么不自动建全部

用户账号里有 65 条帖子，只有 3 条属于四十周项目。**不要给 65 条全建发布记录**——只有匹配上已知帖子或草稿的才建，其余留在落地表里当「未归属」。

### 调度

照 `core/channels/publish/scheduler/` 那个 `@Cron` 的写法加一个：

- 默认 **每 3 小时**一次，每个 `(平台, 账号)` 一个工单
- 有新发布记录登记时**立刻插一次**
- 工单要带 `targetDeviceId` —— 创作平台需要登录态，只能在用户那台装了插件、登录着的机器上跑
- 那台机器离线时工单就排队等着（`availableAt` 照常、租约回收照常）。**连续 N 次到期没人领就推一条 Bark 提醒**

### 错误码

`20700` 段：地址不在白名单 / 没登录 / 列表没出现 / 一条都没读到 / 滚动超上限 / 指标认不出来。

## 四、网页侧

项目详情页的「数据」标签页（阶段 0 留的第四个占位还空着）：

- 每条帖子一行：标题、发布时间、五个指标的**当前值**和**变化趋势**
- 点开看时间序列（那几次快照连成的折线）
- 按方向聚合：这个方向下所有帖子的数据汇总——**这才是整套设计的目的**
- 单独一块「未归属的帖子」：落地表里 `unmatched` 的，能一键认领到某个项目和方向

## 五、验收

1. 在用户那台机器上手动建一个 `sync_creator_notes` 工单，插件领到、执行、回报
2. 回报里 65 条都在，`reachedEnd: true`
3. 四十周那三条**自动匹配到了正确的项目和方向**（靠草稿标题）
4. 五个指标**对得上**：浏览 3030 / 评论 9 / 点赞 1 —— 特别确认赞和评论没对调
5. 其余 62 条落在「未归属」里，没有被乱建成发布记录
6. 把 spec 里某个图标指纹故意改错 → 那张卡进 `unrecognized`，**不是猜一个值**
7. `entryUrl` 换成白名单外的域名 → 直接拒绝
8. 等 3 小时，确认调度自动建了下一个工单，数据出现第二个快照点
