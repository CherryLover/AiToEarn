import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { SchemaTypes } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/**
 * 设备状态。
 * 注意：真正的在线判定看 `lastSeenAt`（心跳间隔的 3 倍以内算在线），
 * 这个字段只是最后一次已知状态的快照，浏览器休眠时连接会悄悄断掉，不能靠它判断。
 */
export enum DeviceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
}

/** 设备上登录了哪个平台的哪个号 */
export interface DeviceAccount {
  platform: string
  accountName?: string
  accountId?: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'device' })
export class Device extends WithTimestampSchema {
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

  /** 人起的名字，如「家里的 Mac」 */
  @Prop({ required: true })
  name: string

  /** 长期设备令牌的哈希。明文只在配对成功时返回一次，库里永远只有哈希 */
  @Prop({ required: true, unique: true, index: true })
  tokenHash: string

  /** 能干什么，如 ['xhs','douyin','wechat_channels'] */
  @Prop({ type: [String], default: [] })
  capabilities: string[]

  /** 登录了哪些号 */
  @Prop({ type: [SchemaTypes.Mixed], default: [] })
  accounts: DeviceAccount[]

  @Prop({
    required: true,
    type: String,
    enum: DeviceStatus,
    default: DeviceStatus.OFFLINE,
    index: true,
  })
  status: DeviceStatus

  /** 最后一次心跳时间，在线判定只看它 */
  @Prop({ index: true })
  lastSeenAt?: Date

  /** 插件版本 */
  @Prop()
  version?: string

  /** 哪台机器，如 macOS 15 */
  @Prop()
  platform?: string

  /** 吊销时间。一旦有值，令牌立即失效，设备也不再出现在列表里 */
  @Prop({ index: true })
  revokedAt?: Date
}

export const DeviceSchema = SchemaFactory.createForClass(Device)
