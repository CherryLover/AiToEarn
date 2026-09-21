import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { SchemaTypes } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/**
 * 执行工单类型。
 * 注意跟 AI 服务的 ContentGenerationTask / AgentTask 没有任何关系，那是另一套东西。
 */
export enum ExecutionTaskType {
  /** 发布一条内容 */
  PUBLISH = 'publish',
  /** 去平台找回刚发的帖子链接 */
  CLAIM_LINK = 'claim_link',
  /**
   * 采集某条帖子的数据。
   * 保留定义但没有实现：实测小红书没有可寻址的单帖入口，按帖子逐条采这个模型不成立。
   * 将来别的平台如果真能按帖子采再说，现在走 SYNC_CREATOR_NOTES。
   */
  COLLECT_METRICS = 'collect_metrics',
  /** 把一个创作平台账号的作品列表整张读回来 */
  SYNC_CREATOR_NOTES = 'sync_creator_notes',
  /** 打通用，原样返回 */
  ECHO = 'echo',
}

export enum ExecutionTaskMode {
  /** 设备自动执行 */
  AUTO = 'auto',
  /** 内容打包给人，人去发完回来登记；不进入领取流程，设备看不见 */
  MANUAL = 'manual',
}

export enum ExecutionTaskStatus {
  /** 待领取 */
  PENDING = 'pending',
  /** 已被某设备领走，租约有效 */
  LEASED = 'leased',
  /** 设备报告开始执行 */
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  /** 重试用尽 */
  FAILED = 'failed',
  /** 人工取消 */
  CANCELLED = 'cancelled',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'executionTask' })
export class ExecutionTask extends WithTimestampSchema {
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

  @Prop({ required: true, type: String, enum: ExecutionTaskType, index: true })
  type: ExecutionTaskType

  @Prop({
    required: true,
    type: String,
    enum: ExecutionTaskMode,
    default: ExecutionTaskMode.AUTO,
    index: true,
  })
  mode: ExecutionTaskMode

  @Prop({
    required: true,
    type: String,
    enum: ExecutionTaskStatus,
    default: ExecutionTaskStatus.PENDING,
    index: true,
  })
  status: ExecutionTaskStatus

  /**
   * 指定必须由哪台设备执行；空表示任意合格设备都能领。
   * 跟 `deviceId` 分开：重排时 `deviceId` 会被清掉，这里不会，
   * 否则「失败重排一次」就会把不指定设备的工单永久绑死在刚失败的那台机器上。
   */
  @Prop({ index: true })
  targetDeviceId?: string

  /** 当前（或最近一次）持有工单的设备 */
  @Prop({ index: true })
  deviceId?: string

  /** 干这活需要的能力，如 xhs；空表示谁都能干 */
  @Prop({ index: true })
  requiredCapability?: string

  /** 按 type 不同，见 contract-skeleton 第四节 */
  @Prop({ required: true, type: SchemaTypes.Mixed, default: {} })
  payload: Record<string, unknown>

  /** 执行结果 */
  @Prop({ type: SchemaTypes.Mixed })
  result?: Record<string, unknown>

  /** 失败原因（给人看的） */
  @Prop()
  error?: string

  /** 本次租约的唯一 id。续租和回报结果都必须带上它，对不上一律拒绝 */
  @Prop()
  leaseId?: string

  /** 租约到期时间 */
  @Prop({ index: true })
  leaseExpiresAt?: Date

  /** 已尝试次数 */
  @Prop({ required: true, default: 0 })
  attempts: number

  @Prop({ required: true, default: 3 })
  maxAttempts: number

  /** 到点才可领取。排期和重试退避都用它 */
  @Prop({ required: true, index: true, default: () => new Date() })
  availableAt: Date

  /** 越小越先 */
  @Prop({ required: true, index: true, default: 100 })
  priority: number

  @Prop()
  startedAt?: Date

  @Prop()
  finishedAt?: Date
}

export const ExecutionTaskSchema = SchemaFactory.createForClass(ExecutionTask)

/** 领取时命中的组合索引：先按状态和模式过滤，再按可领取时间，最后按优先级排序 */
ExecutionTaskSchema.index({ status: 1, mode: 1, availableAt: 1, priority: 1 })
/** 回收过期租约时扫的索引 */
ExecutionTaskSchema.index({ status: 1, leaseExpiresAt: 1 })
