import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { SchemaTypes } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/**
 * 通知规则类型。
 *
 * 现在只有一条，但**结构上是数组**（contract-settings 第四节）：以后加「发布失败」「工单超时」
 * 之类的规则，只要往这里加一个枚举值，库里加一条规则对象，不用改表结构。
 */
export enum NotifyRuleType {
  /** AI 生成素材结束后通知 */
  DRAFT_READY = 'draft_ready',
}

/** 一条通知规则 */
export interface NotifyRule {
  type: NotifyRuleType
  enabled: boolean
}

/** 新建配置时给的默认规则：默认开着，和阶段 4 的行为一致 */
export const DEFAULT_NOTIFY_RULES: readonly NotifyRule[] = [
  { type: NotifyRuleType.DRAFT_READY, enabled: true },
]

/**
 * 拿一份默认规则的独立副本。
 *
 * 别直接把 `DEFAULT_NOTIFY_RULES` 或它的浅拷贝写进文档：里面的对象是同一份引用，
 * Mongoose 建文档时会接着改它，等于所有用户的默认规则共用一组对象。
 */
export function cloneDefaultNotifyRules(): NotifyRule[] {
  return DEFAULT_NOTIFY_RULES.map(rule => ({ ...rule }))
}

/**
 * 按用户存的通知配置（contract-settings 第四节）。
 *
 * **为什么单独一张表，而不是挂在 user 上**：user 是登录鉴权的热路径——每个请求都要
 * `userRepository.getById()` 走一遍（见 app.module.ts 的 `getOpenUser`）。把推送密钥塞进去，
 * 等于每个请求都把密钥读进内存、也更容易被某个返回 user 的接口顺手带出去。
 * 通知配置是低频旁支数据，单独一张表读写都可控，将来要加密也只动这一张。
 *
 * **密钥是明文存的，这一轮不做加密。** 加密要引入密钥管理（主密钥放哪、怎么轮换、怎么迁移存量），
 * 那是另一件事。这里写清楚是为了不让后来人误以为库里那一列是密文——
 * 库被拖走 = 密钥泄露，运维上要按明文凭据对待。
 * 接口侧的约束是另一回事：`barkKey` 永远只回掩码，任何日志都不打印它。
 */
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'userNotifySetting' })
export class UserNotifySetting extends WithTimestampSchema {
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

  /** 推送总开关。关掉时这条自定义通道不用了，退回服务器 .env 的默认通道 */
  @Prop({ required: true, type: Boolean, default: false })
  enabled: boolean

  /** Bark 推送地址，形如 https://<域名>/<设备key>/。用户填什么就是什么，发之前过 SSRF 校验 */
  @Prop({ required: true, type: String, default: '' })
  barkBaseUrl: string

  /** 请求头 bark-key 的值。**明文存储**，原因见类注释 */
  @Prop({ required: true, type: String, default: '' })
  barkKey: string

  /** 通知分组 */
  @Prop({ required: true, type: String, default: 'AiToEarn' })
  group: string

  /** 通知规则，一条规则一个对象。空数组当作「都开着」 */
  @Prop({ type: [SchemaTypes.Mixed], default: () => cloneDefaultNotifyRules() })
  rules: NotifyRule[]
}

export const UserNotifySettingSchema = SchemaFactory.createForClass(UserNotifySetting)

/** 一个用户一条配置 */
UserNotifySettingSchema.index({ userId: 1, userType: 1 }, { unique: true })
