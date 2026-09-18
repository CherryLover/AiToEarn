import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { FilterQuery, Model } from 'mongoose'
import { Project, ProjectStatus } from '../schemas'
import { BaseRepository } from './base.repository'

@Injectable()
export class ProjectRepository extends BaseRepository<Project> {
  constructor(
    @InjectModel(Project.name) projectModel: Model<Project>,
  ) {
    super(projectModel)
  }

  /** 按英文名查项目（英文名全局唯一） */
  async getByName(name: string) {
    return await this.findOne({ name })
  }

  /** 列出用户的项目，可按状态过滤，按创建时间倒序 */
  async listByUserId(userId: string, status?: ProjectStatus) {
    const filter: FilterQuery<Project> = { userId }
    if (status)
      filter.status = status

    return await this.find(filter, { sort: { createdAt: -1 } })
  }

  /** 英文名是否已被占用（全局） */
  async existsByName(name: string): Promise<boolean> {
    return await this.exists({ name })
  }
}
