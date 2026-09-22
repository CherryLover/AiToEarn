import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model } from 'mongoose'
import { Angle, AngleStatus } from '../schemas'
import { BaseRepository } from './base.repository'

/** 方向列表的过滤条件；都不传就是这个项目下的全量方向 */
export interface AngleListFilters {
  status?: AngleStatus
  /** 按确认状态过滤：true 只要已确认的，false 只要待确认的，不传则全都要 */
  confirmed?: boolean
}

@Injectable()
export class AngleRepository extends BaseRepository<Angle> {
  constructor(
    @InjectModel(Angle.name) angleModel: Model<Angle>,
  ) {
    super(angleModel)
  }

  /** 列出一个项目下的方向，可按状态和确认与否过滤；按创建时间正序，树的兄弟节点顺序才稳定 */
  async listByProjectId(projectId: string, filters: AngleListFilters = {}) {
    const filter: FilterQuery<Angle> = { projectId }
    if (filters.status)
      filter.status = filters.status
    if (filters.confirmed !== undefined)
      filter.confirmedAt = { $exists: filters.confirmed }

    return await this.find(filter, { sort: { createdAt: 1 } })
  }

  /** 按 id 批量取这个项目下的方向；批量采用之前要拿它核一遍归属 */
  async listByProjectIdAndIds(projectId: string, angleIds: string[]) {
    return await this.find({ projectId, _id: { $in: angleIds } }, { sort: { createdAt: 1 } })
  }

  /** 按 slug 查方向（slug 在项目内唯一） */
  async getBySlug(projectId: string, slug: string) {
    return await this.findOne({ projectId, slug })
  }

  /** slug 在这个项目里是否已被占用 */
  async existsBySlug(projectId: string, slug: string): Promise<boolean> {
    return await this.exists({ projectId, slug })
  }

  /** 名下还有几个子方向，删之前要看 */
  async countChildren(parentAngleId: string): Promise<number> {
    return await this.count({ parentAngleId })
  }

  /**
   * 批量写「采用时间」。只动还没确认过的，已确认的一条都不碰——
   * 「什么时候被人采用的」是一次性事实，重复点不该把它往后挪。
   */
  async updateManyConfirmedAtByIds(angleIds: string[], confirmedAt: Date): Promise<void> {
    await this.model.updateMany(
      { _id: { $in: angleIds }, confirmedAt: { $exists: false } },
      { $set: { confirmedAt } },
    ).exec()
  }
}
