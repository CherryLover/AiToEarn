import type { AgentModelsVo } from './agent-models.types'
import http from '@/utils/request'

/**
 * 去上游拉一次可用模型清单，给引导页的「默认模型」下拉用。
 *
 * 一律 `silent`：拉不到不该在用户脸上弹红框——那一格会退回手填输入框，
 * 原因显示在字段下面，人还能继续把配置填完。
 *
 * 要登录。清单是照**已经保存的** `agent.baseUrl` / `agent.apiKey` 去拉的，
 * 所以地址或 Key 刚改完还没保存时，拉回来的还是旧上游的清单。
 */
export function getAgentModelsApi(silent = true) {
  return http.get<AgentModelsVo>('system/agent-models', undefined, silent)
}
