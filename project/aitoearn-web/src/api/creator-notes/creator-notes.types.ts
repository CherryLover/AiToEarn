/**
 * 创作平台采回来的数据（CreatorNoteRow / PostMetric）接口类型
 * 字段严格对应服务端 core/creator-notes/creator-notes.vo.ts，不要在此处自行增删字段或改名。
 */

/**
 * 一行采集数据有没有归到某条发布记录上。
 * 对应服务端 CreatorNoteMatchState。
 */
export enum MatchState {
  /** 归到了一条发布记录上 */
  Matched = 'matched',
  /** 没找到对应的发布记录或草稿，等人认领 */
  Unmatched = 'unmatched',
  /** 标题被截断，前缀匹配命中多条，候选在 matchCandidates 里 */
  Ambiguous = 'ambiguous',
}

/**
 * 五个指标。
 * 顺序按平台卡片上的图标顺序：浏览 / 评论 / 点赞 / 收藏 / 分享。
 * 服务端是按图标指纹认的，不是按位置认的。
 */
export interface NoteMetrics {
  views: number
  comments: number
  likes: number
  collects: number
  shares: number
}

/** 落地表里的一行，原样存的采集结果 + 归属结果 */
export interface CreatorNoteRow {
  id: string
  platform: string
  accountId?: string
  /** 卡片上的标题，原样 */
  title: string
  /** 被平台截断了，只能做前缀匹配 */
  titleTruncated: boolean
  /** 卡片上的发布时间，原样 */
  publishedAtText: string
  /** 服务端按平台时区解析出来的；解析不了就没有这个字段 */
  publishedAt?: string
  metrics: NoteMetrics
  collectedAt: string
  executionTaskId?: string
  matchedPublishedPostId?: string
  matchState: MatchState
  /** ambiguous 时的候选：帖子 id 或草稿路径 */
  matchCandidates: string[]
}

export interface CreatorNoteRowListData {
  list: CreatorNoteRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface GetCreatorNoteRowListParams {
  page?: number
  pageSize?: number
  platform?: string
  accountId?: string
  matchState?: MatchState
  matchedPublishedPostId?: string
}

/** 折线上的一个点 */
export interface PostMetricPoint {
  collectedAt: string
  metrics: NoteMetrics
}

/** 一条帖子的当前值和变化趋势，服务端已按发布时间倒序排好 */
export interface PostMetricTrend {
  publishedPostId: string
  title: string
  /** 发布时间；老记录可能没登记过 */
  publishedAt?: string
  latest: NoteMetrics
  /** 跟上一个采集点的差；只采过一次的帖子没有这个字段 */
  delta?: NoteMetrics
  latestCollectedAt: string
  snapshotCount: number
}

/** 一个方向下所有帖子的汇总 */
export interface AngleMetricTotal {
  /** 没挂方向的帖子汇总在没有这个字段的那一条里 */
  angleId?: string
  postCount: number
  totals: NoteMetrics
}

export interface CreateSyncTaskParams {
  platform: string
  accountId?: string
  projectId?: string
  targetDeviceId?: string
}

/** 把一行未归属的数据直接建成发布记录 */
export interface AdoptCreatorNoteRowParams {
  projectId: string
  angleId?: string
}

export interface ProjectMetricsParams {
  angleId?: string
  /** 往回看多少天，默认 30 */
  days?: number
}
