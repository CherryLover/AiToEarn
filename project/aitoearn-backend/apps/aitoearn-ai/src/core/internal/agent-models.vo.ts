import { createZodDto } from '@yikart/common'
import { z } from 'zod'

/**
 * 上游模型清单的出参。
 *
 * 拉不到也是 200，原因写在 `detail` 里——引导页拿不到清单要退回手填，
 * 而不是收一个错误码然后把「默认模型」这一格变成死路。
 */
const InternalAgentModelsVoSchema = z.object({
  models: z.array(z.string()).describe('上游报上来的模型名，拉不到就是空数组'),
  detail: z.string().nullable().describe('拉不到时的原因，给人看的；绝不含任何 Key'),
})
export class InternalAgentModelsVo extends createZodDto(InternalAgentModelsVoSchema, 'InternalAgentModelsVo') {}
