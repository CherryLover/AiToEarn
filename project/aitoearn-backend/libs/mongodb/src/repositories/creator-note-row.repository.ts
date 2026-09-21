import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Pagination } from '@yikart/common'
import { FilterQuery, Model } from 'mongoose'
import { CreatorNoteMatchState, CreatorNoteMetrics, CreatorNoteRow } from '../schemas'
import { BaseRepository } from './base.repository'

const MONGO_DUPLICATE_KEY_ERROR = 11000

export interface CreateCreatorNoteRowParams {
  userId: string
  userType: CreatorNoteRow['userType']
  platform: string
  accountId?: string
  title: string
  titleTruncated: boolean
  publishedAtText: string
  publishedAt?: Date
  metrics: CreatorNoteMetrics
  collectedAt: Date
  executionTaskId?: string
  matchedPublishedPostId?: string
  matchState: CreatorNoteMatchState
  matchCandidates: string[]
}

export interface ListCreatorNoteRowsParams extends Pagination {
  userId: string
  platform?: string
  accountId?: string
  matchState?: CreatorNoteMatchState
  matchedPublishedPostId?: string
  collectedFrom?: Date
  collectedTo?: Date
}

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === MONGO_DUPLICATE_KEY_ERROR
}

@Injectable()
export class CreatorNoteRowRepository extends BaseRepository<CreatorNoteRow> {
  constructor(
    @InjectModel(CreatorNoteRow.name) creatorNoteRowModel: Model<CreatorNoteRow>,
  ) {
    super(creatorNoteRowModel)
  }

  /**
   * 落一行；同一次采集里这条帖子已经落过就返回 null。
   *
   * 唯一索引撞车不当错误处理：插件把同一份结果重报一次是正常的
   * （租约还在、网络抖了一下重试），第二次应该安安静静地什么都不做，
   * 而不是让整个入库过程炸掉、把后面几十行也一起丢了。
   */
  async createIfAbsent(params: CreateCreatorNoteRowParams) {
    try {
      return await this.create(params)
    }
    catch (error) {
      if (isDuplicateKeyError(error))
        return null

      throw error
    }
  }

  async getByIdAndUserId(id: string, userId: string) {
    return await this.findOne({ _id: id, userId })
  }

  /** 某条帖子的时间序列，早的在前，网页上直接连成折线 */
  async listByMatchedPublishedPostId(publishedPostId: string, userId: string) {
    return await this.find(
      { matchedPublishedPostId: publishedPostId, userId },
      { sort: { collectedAt: 1 } },
    )
  }

  /** 一个工单采回来的所有行，排查用 */
  async listByExecutionTaskId(executionTaskId: string, userId: string) {
    return await this.find({ executionTaskId, userId }, { sort: { collectedAt: 1 } })
  }

  async countByUserIdAndMatchState(userId: string, matchState: CreatorNoteMatchState): Promise<number> {
    return await this.count({ userId, matchState })
  }

  /**
   * 人工认领：把一行归到某条发布记录上。
   *
   * 守住「还没归属」这个前提：已经 matched 的行再认领一次会把之前的归属悄悄改掉，
   * 而那条帖子下面已经有算好的快照了，改归属等于让两条帖子的折线都变成错的。
   */
  async updateAsMatchedById(id: string, userId: string, publishedPostId: string) {
    return await this.updateOne(
      { _id: id, userId, matchState: { $ne: CreatorNoteMatchState.MATCHED } },
      {
        $set: {
          matchedPublishedPostId: publishedPostId,
          matchState: CreatorNoteMatchState.MATCHED,
          matchCandidates: [],
        },
      },
      { new: true },
    )
  }

  async listWithPagination(params: ListCreatorNoteRowsParams) {
    const { page, pageSize, userId, platform, accountId, matchState, matchedPublishedPostId, collectedFrom, collectedTo } = params

    const collectedAt: { $gte?: Date, $lte?: Date } = {}
    if (collectedFrom)
      collectedAt.$gte = collectedFrom
    if (collectedTo)
      collectedAt.$lte = collectedTo

    const filter: FilterQuery<CreatorNoteRow> = {
      userId,
      ...(platform ? { platform } : {}),
      ...(accountId ? { accountId } : {}),
      ...(matchState ? { matchState } : {}),
      ...(matchedPublishedPostId ? { matchedPublishedPostId } : {}),
      ...(Object.keys(collectedAt).length > 0 ? { collectedAt } : {}),
    }

    const [list, total] = await this.findWithPagination({
      page,
      pageSize,
      filter,
      options: { sort: { collectedAt: -1, title: 1 } },
    })

    return { list, total }
  }
}
