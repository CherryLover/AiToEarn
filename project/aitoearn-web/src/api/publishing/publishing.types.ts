/**
 * 发布登记（PublishedPost）接口类型
 * 字段严格对应服务端 core/publishing/publishing.vo.ts，不要在此处自行增删字段或改名。
 *
 * 这一轮不做真实发布：所有记录都是「内容打包好了，人自己去平台发」，
 * 发完回来登记链接。前端不存在任何调用平台发布接口的封装。
 */

/**
 * 发布状态。和链接状态是两个维度，不要合成一个。
 * 对应服务端 PublishedPostPublishStatus。
 */
export enum PublishStatus {
  /** 已登记，还没发出去 */
  Pending = 'pending',
  /** 正在发（自动发布那条线才会用到，这一轮不产生） */
  Publishing = 'publishing',
  /** 已经发出去了 */
  Published = 'published',
  /** 发失败了 */
  Failed = 'failed',
}

/**
 * 链接状态。「发成功了但没拿到链接」是真实会发生的，所以单独一个维度。
 * 对应服务端 PublishedPostLinkStatus。
 */
export enum LinkStatus {
  /** 还没有链接 */
  None = 'none',
  /** 链接已拿到 */
  Claimed = 'claimed',
  /** 去找链接失败了 */
  ClaimFailed = 'claim_failed',
}

/**
 * 点「准备发布」那一刻的内容快照。
 * 草稿文件之后还可能被改，卡片上给人复制的一律是这份快照。
 */
export interface PublishSnapshot {
  title: string
  body: string
  /** 话题，不带 # */
  topics: string[]
  /** 图片的 OSS 地址，取自名片文件；名片里没有 OSS 地址的图片不会进来 */
  mediaUrls: string[]
}

/**
 * 发布登记列表项，对应 PublishedPostListItemVo。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
/**
 * 这条记录是怎么来的。
 * discovered 的没走过发布流程，是采集时按草稿标题反查出来的，页面上要能看出区别。
 * 对应服务端 PublishedPostSource。
 */
export enum PublishedPostSource {
  /** 在网页上点「准备发布」登记出来的 */
  Registered = 'registered',
  /** 采集时按草稿标题反查出来的 */
  Discovered = 'discovered',
}

export interface PublishedPostListItem {
  id: string
  projectId: string
  /** 属于哪个发布方向，归因用 */
  angleId: string | null
  /** 来源草稿目录，相对项目根 */
  draftPath: string
  platform: string
  /** 发到哪个号 */
  accountId: string | null
  /** 对应的执行工单 */
  executionTaskId: string | null
  publishStatus: PublishStatus
  linkStatus: LinkStatus
  source: PublishedPostSource
  /** 平台侧帖子 id */
  platformPostId: string | null
  /** 帖子链接 */
  postUrl: string | null
  publishedAt: string | null
  /** 人工标记发失败时填的原因 */
  failReason: string | null
  /** 快照标题，列表里直接显示，不用再拉详情 */
  title: string
  /** 快照里有几张图 */
  mediaCount: number
  createdAt: string
  updatedAt: string
}

/**
 * 发布登记详情，对应 PublishedPostDetailVo：比列表项多一份完整快照。
 */
export interface PublishedPostDetail extends PublishedPostListItem {
  snapshot: PublishSnapshot
}

/**
 * 建工单时没能进快照的图片。三种原因是三件不同的事，给人的话不能混成一句：
 * - `card_missing` 名片读不到，也就是物料里找不到这张图（多半文件名写错了）
 * - `oss_missing` 名片在，但里面没有 OSS 地址，这张图还没传上云
 * - `path_not_allowed` 这一行指到 `media/` 外面去了，服务端压根没去读它
 *
 * `path` 的含义跟着原因走：前两种是相对项目根的图片路径；`path_not_allowed` 那种
 * 根本没解析成一个合法路径，给回来的是草稿里原样写的那一行，人得照着它回草稿里改。
 */
export interface SkippedMedia {
  path: string
  reason: 'card_missing' | 'oss_missing' | 'path_not_allowed'
}

/**
 * 从草稿建工单的返回，对应 PublishJobCreatedVo：
 * 建出来的记录 + 三条「这份草稿要人再看一眼」的提示。
 *
 * 后两个标记是读草稿那一刻才说得清的，服务端不落库：
 * 列表和详情里都没有，只有刚打包完的这一次返回里有。
 */
export interface PublishJobCreated {
  post: PublishedPostDetail
  /** 没进快照的图片：找不到名片、名片里没有 OSS 地址，或者这行声明指到 `media/` 外面去了 */
  skippedMedia: SkippedMedia[]
  /**
   * 草稿里有没有声明配图（frontmatter 的 `images`、`## 配图` 小节、血缘的 `mediaRefs`，有一处算一处）。
   * false = 一张都没声明，和「声明了但没打包进来」（看 `skippedMedia`）不是一回事。
   */
  mediaDeclared: boolean
  /**
   * 正文是不是整篇原文兜出来的。true = 这份草稿没写 `## 正文` 小节，
   * 正文里多半连记账清单带小标题全在，发之前得人工删一遍。
   */
  bodyFallback: boolean
}

/**
 * 发布登记列表分页返回，对应 PublishedPostListVo。
 */
export interface PublishedPostListData {
  page: number
  pageSize: number
  totalPages: number
  total: number
  list: PublishedPostListItem[]
}

/**
 * 删除登记接口返回，对应 PublishedPostDeletedVo。
 */
export interface PublishedPostDeleted {
  id: string
  /** 一并删掉的执行工单 id */
  executionTaskId: string | null
}

/**
 * 列表筛选与分页参数，全部可选。
 */
export interface GetPublishedPostListParams {
  angleId?: string
  platform?: string
  publishStatus?: PublishStatus
  linkStatus?: LinkStatus
  page?: number
  pageSize?: number
}

/**
 * 从草稿建发布工单的请求参数。
 * `mode` 这一轮只接受 `manual`，服务端拒绝 `auto`：自动发布是插件那条线的事。
 */
export interface CreateFromDraftParams {
  /** 草稿目录，相对项目根，如 drafts/2026-09-18-xhs-pain-point */
  draftPath: string
  platform: string
  accountId?: string
  mode: 'manual'
}

/**
 * 人工回填链接的请求参数。
 */
export interface CompletePublishedPostParams {
  postUrl: string
  platformPostId?: string
}

/**
 * 人工标记发失败的请求参数。
 */
export interface FailPublishedPostParams {
  reason: string
}
