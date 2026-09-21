import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Pagination } from '@yikart/common'
import { FilterQuery, Model } from 'mongoose'
import {
  PublishedPost,
  PublishedPostLinkStatus,
  PublishedPostPublishStatus,
} from '../schemas'
import { BaseRepository } from './base.repository'

export interface ListPublishedPostsParams extends Pagination {
  userId: string
  projectId: string
  angleId?: string
  platform?: string
  publishStatus?: PublishedPostPublishStatus
  linkStatus?: PublishedPostLinkStatus
}

/** Mongo 的 `$regex` 认这些元字符，标题里出现它们是常事（`(内测)`、`3+1`），必须转义 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface CompletePublishedPostParams {
  id: string
  userId: string
  postUrl: string
  platformPostId?: string
  publishedAt: Date
}

@Injectable()
export class PublishedPostRepository extends BaseRepository<PublishedPost> {
  constructor(
    @InjectModel(PublishedPost.name) publishedPostModel: Model<PublishedPost>,
  ) {
    super(publishedPostModel)
  }

  async getByIdAndUserId(id: string, userId: string) {
    return await this.findOne({ _id: id, userId })
  }

  /** 按执行工单反查发布记录：工单载荷放不下反向引用，只能靠这条 */
  async getByExecutionTaskId(executionTaskId: string, userId: string) {
    return await this.findOne({ executionTaskId, userId })
  }

  /**
   * 同一条帖子是不是已经登记过了。
   * `excludeId` 用来把自己排掉——重复回填自己不算重复登记。
   */
  async countByPlatformPostId(platform: string, platformPostId: string, excludeId?: string): Promise<number> {
    const filter: FilterQuery<PublishedPost> = { platform, platformPostId }
    if (excludeId)
      filter._id = { $ne: excludeId }

    return await this.count(filter)
  }

  /**
   * 人工回填链接：一次把两个状态都推到位。
   *
   * 守卫住「还没发布成功」这个前提，已经是 published 的返回 null，
   * 免得一条帖子被登记两遍链接。
   */
  async updateAsPublishedById(params: CompletePublishedPostParams) {
    return await this.updateOne(
      {
        _id: params.id,
        userId: params.userId,
        publishStatus: { $ne: PublishedPostPublishStatus.PUBLISHED },
      },
      {
        $set: {
          publishStatus: PublishedPostPublishStatus.PUBLISHED,
          linkStatus: PublishedPostLinkStatus.CLAIMED,
          postUrl: params.postUrl,
          ...(params.platformPostId ? { platformPostId: params.platformPostId } : {}),
          publishedAt: params.publishedAt,
          failReason: null,
        },
      },
      { new: true },
    )
  }

  /** 人工标记发失败。已经发出去的不让改成失败，返回 null */
  async updateAsFailedById(id: string, userId: string, reason: string) {
    return await this.updateOne(
      {
        _id: id,
        userId,
        publishStatus: { $ne: PublishedPostPublishStatus.PUBLISHED },
      },
      {
        $set: {
          publishStatus: PublishedPostPublishStatus.FAILED,
          failReason: reason,
        },
      },
      { new: true },
    )
  }

  /** 建完工单之后回填工单 id，两边互相认得 */
  async updateExecutionTaskIdById(id: string, executionTaskId: string) {
    return await this.updateById(id, { $set: { executionTaskId } })
  }

  async deleteByIdAndUserId(id: string, userId: string) {
    const result = await this.deleteOne({ _id: id, userId })
    return result.deletedCount > 0
  }

  /**
   * 采集匹配第一条规则：按「平台 + 快照标题 + 发布时间同一分钟」找已知帖子。
   *
   * 时间放宽到同一分钟，因为创作平台的卡片上只精确到分钟
   * （`2026-09-18 08:28`），秒是我们这边登记时自己记的。
   */
  async listByPlatformAndTitleInMinute(params: {
    userId: string
    platform: string
    title: string
    minuteStart: Date
    minuteEnd: Date
  }) {
    return await this.find({
      'userId': params.userId,
      'platform': params.platform,
      'snapshot.title': params.title,
      'publishedAt': { $gte: params.minuteStart, $lt: params.minuteEnd },
    })
  }

  /**
   * 标题被平台截断时走的前缀匹配。
   *
   * 命中多条时**不挑一条**，原样返回让上层标成 ambiguous——
   * 挑错了会让两条帖子的数据都变成错的，而且错得看不出来。
   */
  async listByPlatformAndTitlePrefix(params: {
    userId: string
    platform: string
    titlePrefix: string
    limit: number
  }) {
    return await this.find(
      {
        'userId': params.userId,
        'platform': params.platform,
        'snapshot.title': { $regex: `^${escapeRegExp(params.titlePrefix)}` },
      },
      { limit: params.limit },
    )
  }

  async listWithPagination(params: ListPublishedPostsParams) {
    const { page, pageSize, userId, projectId, angleId, platform, publishStatus, linkStatus } = params

    const filter: FilterQuery<PublishedPost> = {
      userId,
      projectId,
      ...(angleId ? { angleId } : {}),
      ...(platform ? { platform } : {}),
      ...(publishStatus ? { publishStatus } : {}),
      ...(linkStatus ? { linkStatus } : {}),
    }

    const [list, total] = await this.findWithPagination({
      page,
      pageSize,
      filter,
      options: { sort: { createdAt: -1 } },
    })

    return { list, total }
  }
}
