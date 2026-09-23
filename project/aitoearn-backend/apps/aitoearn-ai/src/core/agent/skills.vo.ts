import { createZodDto } from '@yikart/common'
import { z } from 'zod'

export const SkillVoSchema = z.object({
  name: z.string().describe('技能名，同时是磁盘上的目录名'),
  description: z.string().describe('一句话说明它干什么、什么时候用。技能靠这句话被匹配到'),
  builtin: z.boolean().describe('内置的只能看，自定义的能删'),
  updatedAt: z.coerce.date().optional().describe('自定义技能的最后修改时间；内置的没有'),
})
export class SkillVo extends createZodDto(SkillVoSchema, 'SkillVo') {}

export const SkillListVoSchema = z.object({
  list: z.array(SkillVoSchema).describe('内置的和自定义的一起返回，按名字排序'),
})
export class SkillListVo extends createZodDto(SkillListVoSchema, 'SkillListVo') {}
