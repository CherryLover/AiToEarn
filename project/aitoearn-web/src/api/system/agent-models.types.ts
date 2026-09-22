/**
 * 上游模型清单的类型。
 *
 * 对应服务端 `GET /system/agent-models`（`AgentModelsVo`）。
 * **拉不到也是 200**：`models` 空数组 + `detail` 写原因，界面据此退回手填。
 */

export interface AgentModelsVo {
  /** 上游报上来的模型名，拉不到就是空数组 */
  models: string[]
  /** 拉不到时的原因，给人看的；绝不含任何 Key */
  detail: string | null
}
