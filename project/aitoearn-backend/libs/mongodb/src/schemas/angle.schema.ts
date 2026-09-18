import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/** 方向是怎么来的 */
export enum AngleSource {
  /** AI 从物料里提炼出来的 */
  AI = 'ai',
  /** 人手工建的 */
  USER = 'user',
  /** 从另一个方向派生出来的 */
  DERIVED = 'derived',
}

/** 方向是个待验证的假设，状态记的是它验到哪一步了 */
export enum AngleStatus {
  /** 候选：提出来了，还没发过 */
  CANDIDATE = 'candidate',
  /** 测试中：正在按这个方向发内容看数据 */
  TESTING = 'testing',
  /** 有效：数据证明这条线能走 */
  EFFECTIVE = 'effective',
  /** 已淘汰：试过了，不行 */
  RETIRED = 'retired',
}

/**
 * 发布方向。
 *
 * 数据库这边只存元信息和血统，「这个方向具体怎么写」在文件里：
 * `<项目目录>/angles/<slug>.md`（见 docs/rebuild/contract-stage2.md）。
 *
 * 战绩（名下帖子的数据汇总）阶段 5 才做，到时候在这里加 `stats` 一类的字段，
 * 按 `angleId` 从发布记录汇总，不要把它塞进文件——文件只放写作指引。
 *
 * 集合名是 `angle`，不是 contract-core 早期例子里的 `projectAngle`。已按实现定稿
 * （见 contract-core.md「重做已落地的集合名」），**别顺手改**：改了就是建一张空表，老数据全读不到。
 */
@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'angle' })
export class Angle extends WithTimestampSchema {
  id: string

  /** 创建者 */
  @Prop({ required: true, index: true })
  userId: string

  @Prop({
    required: true,
    enum: UserType,
    default: UserType.User,
    index: true,
  })
  userType: UserType

  /** 属于哪个项目 */
  @Prop({ required: true, index: true })
  projectId: string

  /** 文件名用，项目内唯一。规则同项目英文名，但允许修改（改了要同步改文件名） */
  @Prop({ required: true, index: true })
  slug: string

  /** 显示名，可中文 */
  @Prop({ required: true })
  name: string

  /** 这个方向切什么痛点、什么噱头 */
  @Prop()
  desc?: string

  @Prop({
    required: true,
    enum: AngleSource,
    default: AngleSource.USER,
    index: true,
  })
  source: AngleSource

  /** 血统：从哪个方向派生来的。空表示这是一条线的起点 */
  @Prop({ index: true })
  parentAngleId?: string

  @Prop({
    required: true,
    enum: AngleStatus,
    default: AngleStatus.CANDIDATE,
    index: true,
  })
  status: AngleStatus

  /** AI 提炼时吃了哪些背景物料，相对项目根的路径 */
  @Prop({ required: false, type: [String] })
  sourceAssetPaths?: string[]

  /** 提炼时用的提示词 */
  @Prop()
  promptSnapshot?: string
}

export const AngleSchema = SchemaFactory.createForClass(Angle)

/** slug 是文件名，项目内必须唯一；并发建同名方向靠这个索引兜底 */
AngleSchema.index({ projectId: 1, slug: 1 }, { unique: true })
/** 组装方向演进树时按项目取全量，再按血统串起来 */
AngleSchema.index({ projectId: 1, parentAngleId: 1 })
