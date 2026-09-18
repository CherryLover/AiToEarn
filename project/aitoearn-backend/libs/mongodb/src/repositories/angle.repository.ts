import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model } from 'mongoose'
import { Angle, AngleStatus } from '../schemas'
import { BaseRepository } from './base.repository'

@Injectable()
export class AngleRepository extends BaseRepository<Angle> {
  constructor(
    @InjectModel(Angle.name) angleModel: Model<Angle>,
  ) {
    super(angleModel)
  }

  /** 列出一个项目下的方向，可按状态过滤；按创建时间正序，树的兄弟节点顺序才稳定 */
  async listByProjectId(projectId: string, status?: AngleStatus) {
    const filter: FilterQuery<Angle> = { projectId }
    if (status)
      filter.status = status

    return await this.find(filter, { sort: { createdAt: 1 } })
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
}
