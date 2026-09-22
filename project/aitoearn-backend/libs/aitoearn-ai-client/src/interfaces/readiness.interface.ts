/**
 * ai 的 `GET /internal/readiness` 出参。
 *
 * 字段和 `apps/aitoearn-ai/src/core/internal/readiness.vo.ts` 一一对应，
 * 也和 server 回给网页的 `ReadinessItemVo` 同名（contract-runtime-config 4.1）。
 *
 * 这里没有复用 `@yikart/aitoearn-ai-shared` 的 DTO，是因为这一轮只放开了
 * `libs/aitoearn-ai-client` 的改动范围；等有人再碰 shared 时可以合并过去。
 */
export type ReadinessStatus = 'ok' | 'missing' | 'error'

export interface ReadinessItemResponse {
  key: string
  status: ReadinessStatus
  required: boolean
  configPath: string | null
  detail: string | null
}

export interface ReadinessResponse {
  items: ReadinessItemResponse[]
}
