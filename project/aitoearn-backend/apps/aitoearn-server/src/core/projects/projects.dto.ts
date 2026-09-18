import { createZodDto } from '@yikart/common'
import { ProjectStatus } from '@yikart/mongodb'
import { z } from 'zod'

const CreateProjectDtoSchema = z.object({
  name: z.string().describe('项目英文名，同时是目录名，创建后不可修改'),
  displayName: z.string().min(1).max(60).describe('显示名，可中文，可随时修改'),
  desc: z.string().max(500).optional().describe('一句话说明'),
  audience: z.string().max(200).optional().describe('面向谁'),
  goal: z.string().max(200).optional().describe('想达成什么'),
})
export class CreateProjectDto extends createZodDto(CreateProjectDtoSchema, 'CreateProjectDto') {}

/** 不接受 name：英文名创建后永久不可修改，带了也会被忽略 */
const UpdateProjectDtoSchema = z.object({
  displayName: z.string().min(1).max(60).optional().describe('显示名'),
  desc: z.string().max(500).optional().describe('一句话说明'),
  audience: z.string().max(200).optional().describe('面向谁'),
  goal: z.string().max(200).optional().describe('想达成什么'),
})
export class UpdateProjectDto extends createZodDto(UpdateProjectDtoSchema, 'UpdateProjectDto') {}

const ProjectListQueryDtoSchema = z.object({
  status: z.enum(ProjectStatus).optional().describe('按状态过滤，不传则全部返回'),
})
export class ProjectListQueryDto extends createZodDto(ProjectListQueryDtoSchema, 'ProjectListQueryDto') {}
