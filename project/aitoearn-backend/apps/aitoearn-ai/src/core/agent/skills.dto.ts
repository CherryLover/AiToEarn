import { createZodDto } from '@yikart/common'
import { z } from 'zod'

export const SkillUploadDtoSchema = z.object({
  // multipart 里所有字段都是字符串，'true' 也要认
  overwrite: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform(value => value === true || value === 'true')
    .optional()
    .describe('同名时是否覆盖。默认不覆盖，避免手滑顶掉别人传的'),
})
export class SkillUploadDto extends createZodDto(SkillUploadDtoSchema, 'SkillUploadDto') {}
