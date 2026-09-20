# 视觉欠账清单

> 这些是换主色之后显出来的对比度问题，**绝大多数是上游原本就写死的 Tailwind 色板**，不是某一轮改出来的。
> 集中清理，不要一轮扫一轮改——前面六轮就是这么陷进去的。

## 为什么单开一份

主题变量层的根因已经解决（`--warning-text` / `--success-text` 已加，副文色已压深，52 个调用点已换）。
剩下的是**长尾**：全站约 40 个文件带着上游的写死色板，换主色后在亮色模式下显出来，集中在徽章和图标。

## 通用规矩

- 一律换成主题变量，**不要换成另一组写死的颜色**——那只是把问题从一个色换成另一个色
- **`opacity-*` 叠加后的值必须单独算**。外层 opacity 会让实际对比度远低于色值算出来的，前面栽过一次：注释里写 5.56，实际渲染只有 2.74
- 半透明叠色（`/10`、`/15`、`/70`）按原色乘不透明度压在父级底色上合成
- 门槛：正文 4.5:1，图标和大字 3:1
- 亮色暗色都要算。**很多这类问题只坏亮色**
- 改完回头看**同组件的兄弟元素**——前面反复栽在「改了一个漏一个」上

## 两条跨文件的系统性问题

**一、`text-muted-foreground/70` 全站 24 处**，亮色一律 2.81~2.96、暗色 3.61~4.06，全低于正文门槛。
真正是正文的至少有：`AngleCard.tsx:86`、`PublishTab/PublishCard.tsx:411`、`DraftsTab/DraftDetail.tsx:366/389/428`、`MaterialsTab/FileTree.tsx:180`、`PublishTab/PublishRecordTable.tsx:162`、`Chat/ChatMessage/WorkflowComponents.tsx:89`、`Chat/ChatMessage/ToolDetailModal.tsx:99`、登录页三个 placeholder 和分隔文字。
**建议整批处理**：要么别再叠 `/70`，要么定义一个专门的更浅一级的文字色变量。

**二、更低的透明度叠加**：`placeholder:text-muted-foreground/50`（2.07）、`text-muted-foreground/65`（2.69）、`text-muted-foreground/40`（1.76）、`text-destructive/50`（2.29）。
placeholder、标签、日期数字都算正文或可交互图标，**不能按装饰豁免**。

## 逐条清单

### 1. [high] `app/[lng]/chat/[taskId]/components/ChatHeader/index.tsx`

第 200 行评分星星写死 text-amber-400，还带 fill=currentColor。亮色下压在页面底 #fafaf9 上只有 1.65:1，图标门槛 3:1，差一大截，星星基本看不见。这和 star-rating.tsx 这一轮刚修掉的是同一个 bug（那边注释写的 1.52:1，已经换成 text-chart-4），这一处漏了。暗色 10.15:1 没问题，所以只坏亮色。

**怎么改**：照 star-rating.tsx 的写法换成 text-chart-4（亮 #8a6a3a 压页面 4.78:1、压卡片 5.00:1；暗 #c9a36a 7.44/6.80，两边都过 4.5）。

### 2. [high] `app/[lng]/projects/[id]/components/AnglesTab/AngleCard.tsx`

opacity 叠加的实际值：第 53 行整张卡挂 opacity-70，第 39 行淘汰态徽章又用 text-muted-foreground/70。两层相乘后徽章文字实际只有 2.05:1（亮）/ 2.56:1（暗），正文门槛 4.5:1。同一张卡里所有 text-muted-foreground 的副文也被打折到 2.97:1（亮）/ 3.82:1（暗）；text-brand-cyan 掉到 3.23:1（亮）。按色值本身算是看不出来的，必须按叠加后算。

**怎么改**：卡片不要用 opacity-70 整体打折，改成只把标题、边框换成淘汰态的样式（比如 line-through + border-dashed 保留，颜色用 text-muted-foreground 不加 /70），文字色本身别再叠第二层透明度。

### 3. [high] `app/[lng]/projects/[id]/components/AnglesTab/AngleCard.tsx`

第 38 行 Effective 徽章写死 'bg-green-500/15 text-green-600 dark:text-green-400'：亮色下压在卡片上 2.81:1，是徽章正文，门槛 4.5:1。同一个 STATUS_BADGE_CLASS 映射里另外三支（Candidate/Testing/Retired）早就是主题变量了，只有这一支是写死色——改了一半漏一半。

**怎么改**：换成 'border-success/40 bg-success/10 text-success-text'，和 devices.utils.ts 这一轮刚改好的那支对齐（亮 5.29:1 / 暗 7.47:1）。

### 4. [high] `app/[lng]/projects/components/ProjectStatusBadge/index.tsx`

第 27 行「进行中」徽章写死 'bg-green-500/15 text-green-600 dark:text-green-400'：亮色压卡片 2.81:1、压页面 2.71:1，徽章正文门槛 4.5:1。注释里还写着「沿用方向卡片的绿色口径」——结果是把上面那个坏掉的口径一起沿用了。项目列表页每张卡都有这个徽章。

**怎么改**：同样换 'border-success/40 bg-success/10 text-success-text'。

### 5. [high] `app/[lng]/projects/[id]/components/PublishTab/publish.utils.ts`

第 197 行和第 214 行都是 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'，亮色下 3.32:1（压卡片）/ 3.19:1（压页面），徽章正文门槛 4.5:1。这一行和 devices.utils.ts 第 98 行一模一样，那边这一轮已经改成 success 并写了注释说「写死 emerald 亮色下只有 3.43:1」，发布页这两处漏改。

**怎么改**：两处都换成 'border-success/40 bg-success/10 text-success-text'，和 devices.utils.ts 保持一致。

### 6. [high] `components/ui/NotificationCenter.tsx`

这个文件这一轮只改了关闭按钮，四种提示的配色还是写死的 Tailwind 色阶。亮色下 warning 图标 text-yellow-600 压在 bg-yellow-50/95 上只有 2.84:1（第 61 行），图标门槛 3:1 不过；success 图标 text-green-600 也只有 3.08:1（第 50 行），贴着线。暗色那一套 7.7~8.5:1 没问题，坏的只有亮色。另外第 336-339 行进度条也是写死的 green/red/yellow/blue-500，和 loading 那支的 bg-primary 不是一套。

**怎么改**：containerClass / iconClass 改走主题变量：success 用 bg-success/10 + text-success-text，error 用 bg-destructive/10 + text-destructive，warning 用 bg-warning/10 + text-warning-text，info 用 bg-info/10 + text-info；进度条同理换 bg-success / bg-destructive / bg-warning / bg-info。

### 7. [high] `components/PublishDialog/compoents/ErrorSummary/index.tsx`

发布对话框的错误汇总整块是写死的 yellow/amber 色阶，亮色下多处不过线：第 86/88/90 行 text-yellow-600 图标压 bg-yellow-50 只有 2.84:1（图标门槛 3:1）；第 119 行 text-yellow-600 的平台数量文字 2.89:1（正文门槛 4.5:1）；第 139 行 text-amber-600 图标 3.15:1，勉强过图标线但和旁边的不是一套。暗色那一套 8~10:1 没问题。

**怎么改**：整块换成站里已有的告警口径：容器 bg-warning/10 + border-warning/30，图标和次要文字 text-warning-text，标题和正文 text-foreground / text-muted-foreground。

### 8. [high] `app/layout/LayoutSidebar/components/BottomSection/PluginEntry.tsx`

同一个 getStatusInfo 里改了一半：READY / 需更新 / 无权限三支这一轮都换成了 text-warning-text / text-success-text，但第 72、75 行的 NOT_INSTALLED / UNKNOWN 分支还是 text-muted-foreground/70。叠加后侧边栏底色上只有 2.81:1（亮）/ 3.83:1（暗），状态文字是正文，门槛 4.5:1。

**怎么改**：这两行去掉 /70，直接用 text-muted-foreground（侧边栏底上 5.02:1 亮 / 6.31:1 暗）。第 73 行的 dotColor 是装饰小圆点，可以不动。

### 9. [high] `app/[lng]/projects/[id]/components/PublishTab/PublishCard.tsx`

第 350-351 行和第 467-468 行两个告警框写死 'border-amber-500/40 bg-amber-500/10' + 'text-amber-600' 图标，亮色下图标只有 2.96:1，图标门槛 3:1 不过。框里的标题和正文用的是 text-foreground / text-muted-foreground（压在 amber-500/10 上是 4.63~4.73:1，勉强过），也就是同一个框里一半主题变量、一半写死色。

**怎么改**：两处都换成站里统一的告警框写法：'border-warning/30 bg-warning/10' + 图标 text-warning-text（压 bg-warning/10 亮 4.98:1 / 暗 7.24:1）。

### 10. [high] `components/draft-box/components/AiBatchGenerateBar/components/PlatformSelector/index.tsx`

生成页的平台选择器有四处写死 amber，亮色下全不过线：第 132 行 text-amber-500 = 2.13:1；第 178 行 text-amber-600/70 压在 bg-amber-50 上 = 2.19:1；第 253 行 text-amber-600/80 压卡片 = 2.54:1；第 230 行 text-amber-500 图标 = 2.13:1。第 172 行的 bg-amber-50 + text-amber-700 本身是 4.85:1 过线的，但和上面那几个叠了透明度的混在同一个框里。暗色那一套 5.2:1 以上没问题。

**怎么改**：统一换 text-warning-text（并去掉 /70、/80 这层透明度），底色换 bg-warning/10、边框 border-warning/30。

### 11. [high] `components/draft-box/components/GenerationDetailDialog/index.tsx`

第 80 行成功状态图标写死 text-green-500，压在卡片/弹窗底上亮色只有 2.22:1，图标门槛 3:1 不过。同一个文件第 82 行的失败图标已经是 text-destructive 了，成功这一支漏了。

**怎么改**：换成 text-success-text（亮 6.35:1 / 暗 9.18:1）。

### 12. [high] `app/[lng]/ai-social/components/PromptGallery/components/VideoDetailModal.tsx`

第 111、112 行复制成功的对勾图标和「已复制」文字都写死 text-green-500，压在弹窗底上亮色只有 2.22:1，图标要 3:1、文字要 4.5:1，两个都不过。暗色 7.21:1 没问题。首页这个弹窗这一轮没被覆盖到。

**怎么改**：两处都换 text-success-text。

### 13. [high] `components/draft-box/components/AiBatchGenerateBar/components/ToolBarInline/components/ModelSelect/index.tsx`

第 177 行提示文字写死 text-amber-600，压在卡片上亮色 3.20:1，正文门槛 4.5:1 不过。同目录 utils/styles.ts 第 5 行的徽章 'bg-orange-100 text-orange-600' 也是 3.14:1，同样不过。两处都只在亮色坏。

**怎么改**：提示文字换 text-warning-text；徽章换 'border-warning/30 bg-warning/10 text-warning-text'。

### 14. [high] `app/layout/LayoutSidebar/components/BottomSection/PluginEntry.tsx`

text-muted-foreground/70 这个写法全站有 24 处，算出来亮色一律是 2.81~2.96:1、暗色 3.61~4.06:1，全部低于正文 4.5:1。除了上面已单列的 PluginEntry，真正是正文的还有：AngleCard.tsx:86（方向描述占位）、PublishTab/PublishCard.tsx:411（空字段提示）、DraftsTab/DraftDetail.tsx:366/389/428（生成页）、MaterialsTab/FileTree.tsx:180（物料页）、PublishTab/PublishRecordTable.tsx:162、Chat/ChatMessage/WorkflowComponents.tsx:89、Chat/ChatMessage/ToolDetailModal.tsx:99、登录页三个 placeholder 和分隔文字。

**怎么改**：统一去掉 /70 用 text-muted-foreground（变量这一轮已经压深到 #6f6862，压页面 5.25:1、压卡片 5.48:1、压 bg-muted 4.99:1，正文够用）。只有纯装饰的空状态大图标可以保留低透明度。

### 15. [high] `components/draft-box/components/CreateMaterialModal/MobileContent.tsx`

一批更低的透明度叠加，实测都远低于门槛：本文件第 370 行 placeholder:text-muted-foreground/50 = 2.07:1（亮）；AiBatchGenerateBar/components/CaptionPromptField/index.tsx:30 的 text-muted-foreground/65 标签 = 2.69:1、第 38 行 cursor-help 图标 /50 = 2.07:1；accounts/.../MobileCalendar/MobileMonthView.tsx:121 非本月日期 text-muted-foreground/40 = 1.76:1；Chat/ChatMessage/PublishDetailCard/index.tsx:240 的 text-destructive/50 图标 = 2.29:1。placeholder、标签、日期数字都算正文或可交互图标，不能按装饰豁免。

**怎么改**：placeholder 和标签去掉透明度用 text-muted-foreground；日历非本月日期改用 text-muted-foreground（靠字重/底色区分而不是透明度）；错误图标用 text-destructive 不加 /50。

### 16. [medium] `components/Chat/TaskCard/index.tsx`

一致性问题，对比度本身勉强过线。第 68-90 行四个状态徽章还是写死的 *-100/*-700（亮色 4.50~5.60:1，擦线过），而同一个文件第 244 行的收藏红心这一轮刚换成 text-destructive 并写了注释。另外 chat/[taskId]/components/ChatHeader/index.tsx:178 的同款红心还是 text-red-500 fill-red-500（亮色 3.65:1，图标线过了但和 TaskCard 不是一套）。

**怎么改**：徽章四支换 bg-warning/10+text-warning-text、bg-success/10+text-success-text、bg-info/10+text-info、bg-destructive/10+text-destructive；ChatHeader 的红心跟 TaskCard 一样换 text-destructive fill-destructive。

### 17. [medium] `components/Plugin/PluginReady/PublishListTab.tsx`

一致性问题，对比度都过线。同一个 PlatformTaskStatus 枚举，这里第 38 行 COMPLETED 用 'bg-primary/10 text-primary'（5.23:1），而 components/Plugin/PublishDetailModal.tsx 第 58 行 COMPLETED 用 'bg-success/10 text-success-text'（5.55:1）。两个面板并排看是两种绿。

**怎么改**：统一成 'bg-success/10 text-success-text'。

### 18. [medium] `components/Plugin/PluginReady/AccountsTab.tsx`

一致性问题，对比度过线（亮 4.85:1、hover 4.52:1）。这个文件这一轮有六处换成了 text-warning-text / text-success-text，但第 501 行那个按钮还是整串写死的 'bg-amber-50 ... text-amber-700 dark:text-amber-400'，同一个组件两套色。

**怎么改**：换成 'border-warning/30 bg-warning/10 text-warning-text hover:bg-warning/15'，和同文件其它告警对齐。

### 19. [high] `/Users/jiangjiwei/Code/Projects/AiToEarn/project/aitoearn-backend/apps/aitoearn-server/src/core/notify/notify.http.ts` 第 206 行

同一个输入，两个服务给出相反的答案：域名解析慢的时候，server 会把通知发出去，ai 会判超时。server 这边解析域名这一步没有任何时间上限（notify-url.guard.ts 第 275 行直接 await 解析，没有包超时），而且「这一跳还剩多少时间」是在解析之前就算好的，解析花掉的时间根本没从预算里扣。实测：承诺 400 毫秒、解析卡 2500 毫秒时，server 用了 2505 毫秒并且成功返回 200，ai 用了 400 毫秒并报超时。带一次跳转时 server 走了 2 跳 705 毫秒，ai 只走了 1 跳 603 毫秒。注意：这个差异在上线的 b4163e11 上就已经存在，不是这一轮改出来的；每一跳的地址照样逐跳校验并钉死 IP，所以不是 SSRF 绕过，影响是「超时承诺失效 + 两边行为不一致」。最坏情况下 server 可能挂住约 4 次解析时间加 5 秒，而 ai 封顶 5 秒。

**怎么改**：把解析这一步也纳入总预算：像 ai 那样给解析套一个剩余时间的超时，并且在解析完成之后再重新计算这一跳还能用多久，而不是沿用解析前算好的数。两边都改完再一起验证。


## 另一条（非视觉，顺带记着）

`apps/aitoearn-server/src/core/notify/notify-url.guard.ts` 约 275 行：域名解析这一步没有超时上限，而且「这一跳还剩多少时间」是在解析之前算好的，解析花掉的时间没从预算里扣。
实测：承诺 400 毫秒、解析卡 2500 毫秒时，server 用了 2505 毫秒并成功返回，ai 用了 400 毫秒判超时。
**不是安全问题**（每一跳照样逐跳校验、照样钉死 IP），是「超时承诺失效 + 两个服务行为不一致」。上线版本就存在。

---

# 第二批（2026-09-20 清理时独立扫描新发现）

> 第一批 19 条 + 两条系统性问题**已清完并上线**。
> 下面这些是验证 Agent 独立扫描时新找出来的，**同一类问题，都不是那一轮改坏的**。
>
> 规律很清楚：**同文件、同组件里「改了一半漏一半」，以及同一个写法散在多个文件里只改了其中几处。**
> 下一轮清的时候，找到一处先搜全站有没有同样的写法，别再一处一处捡。

| # | 位置 | 问题 | 亮色实测 |
|---|---|---|---|
| 1 | `PublishDialog/.../usePubParamsVerify.tsx:763-765` | 发布对话框三块黄色提醒改好两块，这块漏了。手机端两块并排显示，一黄一橙 | 图标 2.83（门槛 3.0） |
| 2 | `accounts/.../ChannelItem.tsx:68` | 离线账号整行 `opacity-70`，账号名本就是副文色又被打七折。**常驻状态不是过渡态** | 2.88~2.96 |
| 3 | `PublishDialog/.../DateTimePicker.tsx:207` | 非本月日期 `opacity-50`，和刚修好的手机日历同一个写法 | 2.07 |
| 4 | `components/ui/date-picker/index.tsx:176`<br>`date-range-picker/index.tsx:202` | 同一行代码同一个值，两处都漏 | 2.52 |
| 5 | `Chat/.../index.tsx:393,461,632` | 「插件未安装」等提示写死 `text-amber-600`，和刚修好的 ModelSelect 同一个写法 | 3.19 |
| 6 | `MobileMonthView.tsx:94-95`<br>`MobileWeekView.tsx:102-103` | 周六周日表头写死 `text-red-400`。**这一轮正好改了同文件 121 行，往上三行没动** | 2.77 |
| 7 | `accounts/.../RecordCore.tsx:747-748` | 记录类型徽章写死 `bg-green-50 text-green-600` | 3.07 |
| 8 | `PublishDialog/.../useCloseDialog.tsx:26` | 关闭确认弹窗的警告图标写死 `text-yellow-500`。**弹窗里唯一的图标，不是装饰** | 1.91 |
| 9 | `.../index.tsx:255` | 积分数值写死 `text-orange-600`，加粗正文 | 3.59 |

## 判定可留（纯装饰，供参考）

- `VideoModelParamsSelect.tsx:69,71` 的「·」分隔符（`/60`，2.47）——纯标点
- `AspectRatioSelect.tsx:65`、`VideoModelParamsSelect.tsx:133` 未选中的单选圈边框（`/40`，1.76）——偏低但是边框不是文字，下一轮一并看
- 各页空状态大图标（`/30`~`/50`）、侧边栏装饰小圆点、节日摘要分隔点
