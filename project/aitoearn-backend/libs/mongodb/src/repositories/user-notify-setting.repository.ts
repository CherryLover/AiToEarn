import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { Model } from 'mongoose'
import { cloneDefaultNotifyRules, NotifyRule, UserNotifySetting } from '../schemas'
import { BaseRepository } from './base.repository'

/** 保存时能改的字段。`barkKey` 不传表示「不改」，调用方负责把空串换成不传 */
export interface UserNotifySettingPatch {
  enabled?: boolean
  barkBaseUrl?: string
  barkKey?: string
  group?: string
  rules?: NotifyRule[]
}

@Injectable()
export class UserNotifySettingRepository extends BaseRepository<UserNotifySetting> {
  constructor(
    @InjectModel(UserNotifySetting.name)
    private readonly userNotifySettingModel: Model<UserNotifySetting>,
  ) {
    super(userNotifySettingModel)
  }

  async getByUserId(userId: string, userType: UserType = UserType.User) {
    return await this.findOne({ userId, userType })
  }

  /**
   * 保存配置。没有就建一条，有就按传进来的字段覆盖。
   *
   * 用 upsert 而不是「先查再决定 create / update」：并发保存时后者会撞唯一索引。
   *
   * `$setOnInsert` 只在这次保存没带 rules 时才补默认规则——同一个字段同时出现在
   * `$set` 和 `$setOnInsert` 里，Mongo 会直接报路径冲突。
   */
  async upsertByUserId(
    userId: string,
    userType: UserType,
    patch: UserNotifySettingPatch,
  ) {
    const setOnInsert: Record<string, unknown> = { userId, userType }
    if (patch.rules === undefined)
      setOnInsert['rules'] = cloneDefaultNotifyRules()

    return await this.userNotifySettingModel.findOneAndUpdate(
      { userId, userType },
      { $set: patch, $setOnInsert: setOnInsert },
      { upsert: true, new: true },
    ).lean({ virtuals: true }).exec()
  }
}
