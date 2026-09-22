import { createZodDto } from '@yikart/common'
import { z } from 'zod'

/**
 * 就绪检查的出参（contract-runtime-config 4.1）。
 *
 * **字段名是服务端权威，网页照抄**：`key` / `status` / `required` / `configPath` / `detail`
 * 一个字母都不能改，引导页是照着这份写的。
 */
const ReadinessItemVoSchema = z.object({
  key: z.string().describe('检查项标识：agentUpstream | aiChatModels | assets | projectsRoot | notify'),
  status: z.enum(['ok', 'missing', 'error']).describe('ok 通过；missing 没配；error 配了但探不通'),
  required: z.boolean().describe('false 的项不拦人，只提示'),
  configPath: z.string().nullable().describe('对应的配置键路径，如 agent.baseUrl，引导页据此跳到对应字段'),
  detail: z.string().nullable().describe('失败原因原文，给人看的，不做 i18n；绝不含任何 Key'),
})
export class ReadinessItemVo extends createZodDto(ReadinessItemVoSchema, 'ReadinessItemVo') {}

const ReadinessVoSchema = z.object({
  ready: z.boolean().describe('所有 required 项都是 ok'),
  items: z.array(ReadinessItemVoSchema).describe('逐项结果，顺序固定'),
})
export class ReadinessVo extends createZodDto(ReadinessVoSchema, 'ReadinessVo') {}

/**
 * 上游模型清单的出参。
 *
 * 拉不到也是 200，原因写在 `detail` 里——引导页拿不到清单要退回手填输入框，
 * 而不是收一个错误码然后把「默认模型」这一格变成死路。
 */
const AgentModelsVoSchema = z.object({
  models: z.array(z.string()).describe('上游报上来的模型名，拉不到就是空数组'),
  detail: z.string().nullable().describe('拉不到时的原因，给人看的；绝不含任何 Key'),
})
export class AgentModelsVo extends createZodDto(AgentModelsVoSchema, 'AgentModelsVo') {}
