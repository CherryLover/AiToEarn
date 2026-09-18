import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/**
 * 发布状态。
 *
 * 名字前缀不能省：`PublishStatus` / `PublishRecordLinkStatus` 已经被上游那套
 * 多平台发布器占了（`enums/publish.enum.ts`），而 `schemas/index.ts` 是 `export *`，
 * 重名会在桶文件那一层直接撞上。
 */
export enum PublishedPostPublishStatus {
  /** 已登记，还没发出去 */
  PENDING = 'pending',
  /** 正在发（自动发布那条线才会用到） */
  PUBLISHING = 'publishing',
  /** 已经发出去了 */
  PUBLISHED = 'published',
  /** 发失败了 */
  FAILED = 'failed',
}

/**
 * 链接状态。
 *
 * **和发布状态分开是刻意的**（contract-skeleton 第五节）：
 * 「发成功了但没抓到链接」是真实会发生的情况，合成一个字段就变成模糊地带——
 * 到底算成功还是失败？拆开之后，没拿到链接的那些能单独派 `claim_link` 去补，
 * 发布本身的成败不受影响。
 */
export enum PublishedPostLinkStatus {
  /** 还没有链接 */
  NONE = 'none',
  /** 链接已拿到 */
  CLAIMED = 'claimed',
  /** 去找链接失败了 */
  CLAIM_FAILED = 'claim_failed',
}

/**
 * 点「准备发布」那一刻的内容快照。
 *
 * **必须是快照，不能只存草稿路径**（contract-skeleton 第四节）：
 * 草稿文件在排队期间可能被改，发出去的应该是点下那一刻的版本，
 * 否则排期发布会变成薛定谔的内容。
 */
@Schema({ _id: false })
export class PublishedPostSnapshot {
  @Prop({ required: true, default: '' })
  title: string

  @Prop({ required: true, default: '' })
  body: string

  @Prop({ required: true, type: [String], default: [] })
  topics: string[]

  /** 图片 / 视频的 OSS 地址，取自 `media/` 下的图片名片文件 */
  @Prop({ required: true, type: [String], default: [] })
  mediaUrls: string[]
}

export const PublishedPostSnapshotSchema = SchemaFactory.createForClass(PublishedPostSnapshot)

/**
 * 一条「我们发出去的帖子」。
 *
 * 身份由 `platform` + `platformPostId` 唯一确定（contract-skeleton 第五节），
 * `postUrl` 只是给人点的。
 *
 * 跟上游的 `publishRecord` 没有关系：那是多平台发布器的发布流水，
 * 这张表是以 Project 为单位的内容运营中枢自己的发布记录。
 */
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'publishedPost' })
export class PublishedPost extends WithTimestampSchema {
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

  /** 属于哪个项目 */
  @Prop({ required: true, index: true })
  projectId: string

  /** 属于哪个发布方向，归因用 */
  @Prop({ index: true })
  angleId?: string

  /** 来源草稿目录，相对项目根，如 `drafts/2026-09-18-xhs-export-friction` */
  @Prop({ required: true })
  draftPath: string

  /** 平台标识，如 xhs */
  @Prop({ required: true, index: true })
  platform: string

  /** 发到哪个号；手动发布时可以不指定，人自己挑 */
  @Prop({ index: true })
  accountId?: string

  @Prop({ required: true, type: PublishedPostSnapshotSchema })
  snapshot: PublishedPostSnapshot

  /** 对应的执行工单 */
  @Prop({ index: true })
  executionTaskId?: string

  @Prop({
    required: true,
    type: String,
    enum: PublishedPostPublishStatus,
    default: PublishedPostPublishStatus.PENDING,
    index: true,
  })
  publishStatus: PublishedPostPublishStatus

  @Prop({
    required: true,
    type: String,
    enum: PublishedPostLinkStatus,
    default: PublishedPostLinkStatus.NONE,
    index: true,
  })
  linkStatus: PublishedPostLinkStatus

  /** 平台侧帖子 id */
  @Prop()
  platformPostId?: string

  /** 帖子链接 */
  @Prop()
  postUrl?: string

  @Prop()
  publishedAt?: Date

  /** 人工标记「发失败了」时填的原因 */
  @Prop()
  failReason?: string
}

export const PublishedPostSchema = SchemaFactory.createForClass(PublishedPost)

/**
 * 同一条帖子只能登记一次。
 *
 * 契约写的是「稀疏联合唯一索引」，但 Mongo 的 `sparse` 用在联合索引上是
 * **只要有一个键在就索引**，pending 的记录都带着 `platform`、都没有 `platformPostId`，
 * 会被当成一堆 `(platform, null)` 互相撞车——第二条 pending 记录就插不进去了。
 * 所以这里用 `partialFilterExpression` 把范围收到「已经填了平台帖子 id 的那些」，
 * 这才是契约要的语义。
 */
PublishedPostSchema.index(
  { platform: 1, platformPostId: 1 },
  { unique: true, partialFilterExpression: { platformPostId: { $type: 'string' } } },
)
/** 列表主查询：我的 + 这个项目的，按创建时间倒序 */
PublishedPostSchema.index({ userId: 1, projectId: 1, createdAt: -1 })
/** 阶段 5 按方向归因时扫的索引 */
PublishedPostSchema.index({ projectId: 1, angleId: 1, publishStatus: 1 })
