import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { CreatorNoteMetrics, CreatorNoteMetricsSchema } from './creator-note-row.schema'
import { WithTimestampSchema } from './timestamp.schema'

/**
 * 一条已归属帖子在某个时刻的指标快照。
 *
 * **和落地表 `creatorNoteRow` 分开是刻意的**（contract-collect-xhs 第三节）：
 * 落地表是原始数据，一行的身份是「标题 + 发布时间文本」这种平台上的字符串，
 * 而这张表的一行已经带着 `projectId` / `angleId`——
 * 「这个方向下所有帖子的数据汇总」是整套设计的目的，走这张表是一次带索引的聚合，
 * 走落地表得先按 `matchedPublishedPostId` 回查发布记录才知道方向，
 * 而未归属的那几十行还得先滤掉。
 *
 * 重跑匹配时这张表可以整段删掉重建，源数据在落地表里没丢。
 */
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'postMetric' })
export class PostMetric extends WithTimestampSchema {
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
  publishedPostId: string

  @Prop({ required: true, index: true })
  projectId: string

  /** 归因到哪个发布方向，发布记录上没有就留空 */
  @Prop({ index: true })
  angleId?: string

  @Prop({ required: true, index: true })
  platform: string

  @Prop({ required: true, type: CreatorNoteMetricsSchema })
  metrics: CreatorNoteMetrics

  @Prop({ required: true, index: true })
  collectedAt: Date

  /** 这条快照是哪一行落地数据算出来的，出了问题能顺藤摸回去 */
  @Prop({ required: true, index: true })
  sourceRowId: string

  @Prop({ index: true })
  executionTaskId?: string
}

export const PostMetricSchema = SchemaFactory.createForClass(PostMetric)

/** 同一条帖子同一个采集时刻只有一条快照，重复回报不会把折线点堆两份 */
PostMetricSchema.index({ publishedPostId: 1, collectedAt: 1 }, { unique: true })
/** 按方向聚合：这才是整套设计的目的 */
PostMetricSchema.index({ projectId: 1, angleId: 1, collectedAt: -1 })
