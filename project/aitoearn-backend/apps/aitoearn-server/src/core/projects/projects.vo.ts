import { createZodDto } from '@yikart/common'
import { z } from 'zod'

const ProjectDetailVoSchema = z.object({
  id: z.string().describe('项目 ID'),
  name: z.string().describe('英文名/目录名'),
  displayName: z.string().describe('显示名'),
  desc: z.string().nullable().describe('一句话说明'),
  audience: z.string().nullable().describe('面向谁'),
  goal: z.string().nullable().describe('想达成什么'),
  status: z.enum(['active', 'archived']).describe('项目状态'),
  dirName: z.string().describe('磁盘上的实际目录名'),
  archivedAt: z.coerce.date().nullable().describe('归档时间'),
  createdAt: z.coerce.date().describe('创建时间'),
  updatedAt: z.coerce.date().describe('更新时间'),
})
export class ProjectDetailVo extends createZodDto(ProjectDetailVoSchema, 'ProjectDetailVo') {}

const ProjectListItemVoSchema = z.object({
  id: z.string().describe('项目 ID'),
  name: z.string().describe('英文名/目录名'),
  displayName: z.string().describe('显示名'),
  desc: z.string().nullable().describe('一句话说明'),
  status: z.enum(['active', 'archived']).describe('项目状态'),
  createdAt: z.coerce.date().describe('创建时间'),
})
export class ProjectListItemVo extends createZodDto(ProjectListItemVoSchema, 'ProjectListItemVo') {}

const SuggestNameVoSchema = z.object({
  name: z.string().describe('一个当前可用的建议英文名'),
})
export class SuggestNameVo extends createZodDto(SuggestNameVoSchema, 'SuggestNameVo') {}
