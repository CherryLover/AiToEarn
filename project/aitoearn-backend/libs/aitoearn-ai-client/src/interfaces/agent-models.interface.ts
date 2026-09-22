/**
 * ai 的 `GET /internal/agent-models` 出参。
 *
 * 字段和 `apps/aitoearn-ai/src/core/internal/agent-models.vo.ts` 一一对应，
 * 也和 server 回给网页的 `AgentModelsVo` 同名——改名会直接把网页那边打坏。
 */
export interface AgentModelsResponse {
  /** 上游报上来的模型名，拉不到就是空数组 */
  models: string[]
  /** 拉不到时的原因，给人看的；绝不含任何 Key */
  detail: string | null
}
