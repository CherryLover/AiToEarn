import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, PipelineStage } from 'mongoose'
import { CreatorNoteMetrics, PostMetric } from '../schemas'
import { BaseRepository } from './base.repository'

const MONGO_DUPLICATE_KEY_ERROR = 11000

const METRIC_KEYS = ['views', 'comments', 'likes', 'collects', 'shares'] as const

export interface CreatePostMetricParams {
  userId: string
  userType: PostMetric['userType']
  publishedPostId: string
  projectId: string
  angleId?: string
  platform: string
  metrics: CreatorNoteMetrics
  collectedAt: Date
  sourceRowId: string
  executionTaskId?: string
}

/** 一条帖子的当前值 + 跟上一个采集点的差 */
export interface PostMetricTrend {
  publishedPostId: string
  latest: CreatorNoteMetrics
  /** 只有一个采集点时没有差值，网页上显示「暂无对比」而不是显示 0 */
  delta?: CreatorNoteMetrics
  latestCollectedAt: Date
  snapshotCount: number
}

/** 一个方向下所有帖子的当前值汇总 */
export interface AngleMetricTotal {
  angleId: string | null
  postCount: number
  totals: CreatorNoteMetrics
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === MONGO_DUPLICATE_KEY_ERROR
}

/** `$group` 里把最新那一条的每个指标累加起来 */
function sumOfLatest(): Record<string, unknown> {
  return Object.fromEntries(
    METRIC_KEYS.map(key => [key, { $sum: { $ifNull: [`$latest.metrics.${key}`, 0] } }]),
  )
}

/** 最新减上一个采集点，逐个指标 */
function deltaOfMetrics(): Record<string, unknown> {
  return Object.fromEntries(
    METRIC_KEYS.map(key => [
      key,
      {
        $subtract: [
          { $ifNull: [`$latest.metrics.${key}`, 0] },
          { $ifNull: [`$previous.metrics.${key}`, 0] },
        ],
      },
    ]),
  )
}

@Injectable()
export class PostMetricRepository extends BaseRepository<PostMetric> {
  constructor(
    @InjectModel(PostMetric.name) postMetricModel: Model<PostMetric>,
  ) {
    super(postMetricModel)
  }

  /**
   * 写一条快照；同一条帖子同一个采集时刻已经有了就返回 null。
   *
   * 跟落地表一个道理：重复回报不该让折线上多出一个重合的点，也不该让入库整个失败。
   */
  async createIfAbsent(params: CreatePostMetricParams) {
    try {
      return await this.create(params)
    }
    catch (error) {
      if (isDuplicateKeyError(error))
        return null

      throw error
    }
  }

  /** 某条帖子的完整时间序列，早的在前 */
  async listByPublishedPostId(publishedPostId: string, userId: string) {
    return await this.find({ publishedPostId, userId }, { sort: { collectedAt: 1 } })
  }

  /**
   * 项目（或某个方向）下每条帖子的当前值和变化趋势。
   *
   * `since` 不是可选的展示过滤，是**给聚合兜底的窗口**：
   * 每 3 小时一个采集点，不限窗口的话一条帖子一年下来近三千条快照会全被推进同一个分组数组里。
   * 算趋势只需要最近两个点，窗口收住之后这一步的内存占用跟帖子数成正比，跟跑了多久无关。
   */
  async listTrendsByProjectId(params: {
    userId: string
    projectId: string
    angleId?: string
    since: Date
  }): Promise<PostMetricTrend[]> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          userId: params.userId,
          projectId: params.projectId,
          ...(params.angleId ? { angleId: params.angleId } : {}),
          collectedAt: { $gte: params.since },
        },
      },
      { $sort: { publishedPostId: 1, collectedAt: -1 } },
      {
        $group: {
          _id: '$publishedPostId',
          snapshots: { $push: { metrics: '$metrics', collectedAt: '$collectedAt' } },
          snapshotCount: { $sum: 1 },
        },
      },
      {
        $project: {
          snapshotCount: 1,
          latest: { $arrayElemAt: ['$snapshots', 0] },
          previous: { $arrayElemAt: ['$snapshots', 1] },
        },
      },
      {
        $project: {
          publishedPostId: '$_id',
          snapshotCount: 1,
          latest: '$latest.metrics',
          latestCollectedAt: '$latest.collectedAt',
          delta: { $cond: [{ $gt: ['$snapshotCount', 1] }, deltaOfMetrics(), null] },
        },
      },
    ]

    const rows = await this.model.aggregate<{
      publishedPostId: string
      snapshotCount: number
      latest: CreatorNoteMetrics
      latestCollectedAt: Date
      delta: CreatorNoteMetrics | null
    }>(pipeline).exec()

    return rows.map(row => ({
      publishedPostId: String(row.publishedPostId),
      latest: row.latest,
      delta: row.delta ?? undefined,
      latestCollectedAt: row.latestCollectedAt,
      snapshotCount: row.snapshotCount,
    }))
  }

  /**
   * 按方向汇总：每条帖子取它最新的那一条快照，再按 `angleId` 加起来。
   *
   * **不能直接把所有快照 `$sum`**：同一条帖子有几十个采集点，每个点的浏览数都是累计值，
   * 全加起来得到的是一个既不是当前值也不是增量的数。
   */
  async listAngleTotalsByProjectId(params: {
    userId: string
    projectId: string
    since: Date
  }): Promise<AngleMetricTotal[]> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          userId: params.userId,
          projectId: params.projectId,
          collectedAt: { $gte: params.since },
        },
      },
      { $sort: { publishedPostId: 1, collectedAt: -1 } },
      {
        $group: {
          _id: '$publishedPostId',
          latest: { $first: { metrics: '$metrics', angleId: '$angleId' } },
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$latest.angleId', null] },
          postCount: { $sum: 1 },
          ...sumOfLatest(),
        },
      },
      { $sort: { views: -1 } },
    ]

    const rows = await this.model.aggregate<
      { _id: string | null, postCount: number } & CreatorNoteMetrics
    >(pipeline).exec()

    return rows.map(({ _id, postCount, ...totals }) => ({
      angleId: _id === null ? null : String(_id),
      postCount,
      totals: totals as CreatorNoteMetrics,
    }))
  }

  /** 重跑匹配前把某个用户的快照清掉，源数据在落地表里没丢 */
  async deleteManyByUserId(userId: string): Promise<void> {
    await this.deleteMany({ userId })
  }
}
