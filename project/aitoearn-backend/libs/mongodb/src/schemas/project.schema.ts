import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

/** 项目状态 */
export enum ProjectStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'project' })
export class Project extends WithTimestampSchema {
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

  /** 英文名 = 目录名，全局唯一，创建后不可修改 */
  @Prop({ required: true, unique: true, index: true })
  name: string

  /** 显示名，可中文，可随时修改 */
  @Prop({ required: true })
  displayName: string

  /** 一句话说明 */
  @Prop()
  desc?: string

  /** 面向谁 */
  @Prop()
  audience?: string

  /** 想达成什么 */
  @Prop()
  goal?: string

  @Prop({
    required: true,
    enum: ProjectStatus,
    default: ProjectStatus.ACTIVE,
    index: true,
  })
  status: ProjectStatus

  /** 磁盘上的实际目录名。正常等于 name，归档后变成 _archived_<name>_<yyyyMMddHHmmss> */
  @Prop({ required: true })
  dirName: string

  /** 归档时间 */
  @Prop()
  archivedAt?: Date
}

export const ProjectSchema = SchemaFactory.createForClass(Project)
