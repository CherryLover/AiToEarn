import { createZodDto } from '@yikart/common'
import { z } from 'zod'

/**
 * ai 侧就绪检查的出参。
 *
 * 字段名和 `aitoearn-server` 的 `ReadinessItemVo` 一模一样（contract-runtime-config 4.1），
 * server 拿到之后基本是原样透传给网页，**改名会直接把网页那边打坏**。
 */
const InternalReadinessItemVoSchema = z.object({
  key: z.string().describe('检查项标识，如 agentUpstream、aiChatModels'),
  status: z.enum(['ok', 'missing', 'error']).describe('ok 通过；missing 没配；error 配了但探不通'),
  required: z.boolean().describe('false 的项不拦人，只提示'),
  configPath: z.string().nullable().describe('对应的配置键路径，如 agent.baseUrl，引导页据此跳到对应字段'),
  detail: z.string().nullable().describe('失败原因原文，给人看的，不做 i18n；绝不含任何 Key'),
})
export class InternalReadinessItemVo extends createZodDto(InternalReadinessItemVoSchema, 'InternalReadinessItemVo') {}

const InternalReadinessVoSchema = z.object({
  items: z.array(InternalReadinessItemVoSchema).describe('ai 侧能判的检查项，server 合进整体结果'),
})
export class InternalReadinessVo extends createZodDto(InternalReadinessVoSchema, 'InternalReadinessVo') {}
