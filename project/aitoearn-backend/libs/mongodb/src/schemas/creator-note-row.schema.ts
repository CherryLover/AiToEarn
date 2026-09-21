import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/**
 * 这一行采回来的数据有没有归到某条发布记录上。
 *
 * 三档而不是两档（contract-collect-xhs 第三节）：标题被平台截断时只能做前缀匹配，
 * 前缀撞上多条的时候**既不能猜也不能丢**，得有个状态专门表示「有候选但定不下来」，
 * 让人在网页上自己认领。合成两档的话这种行要么被错配、要么被当成没匹配上，
 * 而这两种结果都会让「按方向聚合」这个最终目的算出错的数。
 */
export enum CreatorNoteMatchState {
  /** 归到了一条发布记录上 */
  MATCHED = 'matched',
  /** 没找到对应的发布记录或草稿，留在「未归属」里等人认领 */
  UNMATCHED = 'unmatched',
  /** 前缀匹配命中多条，候选记在 `matchNote` 里 */
  AMBIGUOUS = 'ambiguous',
}

/**
 * 五个指标。
 *
 * 字段写死而不是用 `Record<string, number>`：插件是按图标指纹认指标的，
 * 认不出来的整张卡会进回报的 `unrecognized`、根本不会落到这里，
 * 所以到这一层指标名已经是确定的几个。写死之后按方向聚合能直接 `$sum` 字段，
 * 不用在应用层展开一个动态对象。
 */
@Schema({ _id: false })
export class CreatorNoteMetrics {
  @Prop({ required: true, default: 0 })
  views: number

  @Prop({ required: true, default: 0 })
  comments: number

  @Prop({ required: true, default: 0 })
  likes: number

  @Prop({ required: true, default: 0 })
  collects: number

  @Prop({ required: true, default: 0 })
  shares: number
}

export const CreatorNoteMetricsSchema = SchemaFactory.createForClass(CreatorNoteMetrics)

/**
 * 插件从创作平台列表页读回来的一行，原样落地。
 *
 * **先存下来再谈匹配**（contract-collect-xhs 第三节）：匹配规则将来一定会改
 * （前缀规则要调、平台要加），改完得能拿历史数据重跑一遍。
 * 匹配结果写在同一行上是派生字段，原始的 `title` / `publishedAtText` / `metrics` 不动。
 */
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'creatorNoteRow' })
export class CreatorNoteRow extends WithTimestampSchema {
  id: string

  @Prop({ required: true, index: true })
  userId: string

  @Prop({
    required: true,
    type: String,
    enum: UserType,
    default: UserType.User,
    index: true,
  })
  userType: UserType

  @Prop({ required: true, index: true })
  platform: string

  /** 多号时区分是哪个号采的 */
  @Prop({ index: true })
  accountId?: string

  /** 卡片上的标题，原样 */
  @Prop({ required: true })
  title: string

  /** 平台把标题截断了。截断的只能做前缀匹配 */
  @Prop({ required: true, default: false })
  titleTruncated: boolean

  /** 卡片上的发布时间字符串，原样。插件不转时区 */
  @Prop({ required: true })
  publishedAtText: string

  /** 服务端按平台时区解析出来的时间，解析不了就留空，不猜 */
  @Prop()
  publishedAt?: Date

  @Prop({ required: true, type: CreatorNoteMetricsSchema })
  metrics: CreatorNoteMetrics

  @Prop({ required: true, index: true })
  collectedAt: Date

  /** 哪个工单采的 */
  @Prop({ index: true })
  executionTaskId?: string

  /** 匹配上了才有 */
  @Prop({ index: true })
  matchedPublishedPostId?: string

  @Prop({
    required: true,
    type: String,
    enum: CreatorNoteMatchState,
    default: CreatorNoteMatchState.UNMATCHED,
    index: true,
  })
  matchState: CreatorNoteMatchState

  /** ambiguous 时记下有哪些候选，网页上要显示出来人才知道该选哪个 */
  @Prop({ required: true, type: [String], default: [] })
  matchCandidates: string[]
}

export const CreatorNoteRowSchema = SchemaFactory.createForClass(CreatorNoteRow)

/**
 * 同一次采集里同一条帖子只落一行。
 *
 * 契约写的键是 `(platform, title, publishedAtText, collectedAt)`，这里**多带了 `userId`**：
 * 标题和发布时间都是平台上的公开信息，两个用户采到同一条公开帖子是完全可能的，
 * 不带 userId 的话先落地的那个人会把后来者的整行挡掉，而且挡得悄无声息。
 */
CreatorNoteRowSchema.index(
  { userId: 1, platform: 1, title: 1, publishedAtText: 1, collectedAt: 1 },
  { unique: true },
)
/** 网页「未归属」那一块的主查询 */
CreatorNoteRowSchema.index({ userId: 1, matchState: 1, collectedAt: -1 })
/** 某条帖子的时间序列 */
CreatorNoteRowSchema.index({ matchedPublishedPostId: 1, collectedAt: -1 })
