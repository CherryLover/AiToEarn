import type {
  CreateEchoTaskParams,
  ExecutionTaskDetail,
  ExecutionTaskListData,
  GetExecutionTaskListParams,
} from './execution-task.types'
import http from '@/utils/request'

/**
 * 工单列表，可按项目、设备、类型、状态筛。
 */
export function getExecutionTaskListApi(params?: GetExecutionTaskListParams, silent = true) {
  return http.get<ExecutionTaskListData>('execution-tasks/list', params, silent)
}

/**
 * 工单详情，含载荷和执行结果。
 */
export function getExecutionTaskDetailApi(id: string, silent = true) {
  return http.get<ExecutionTaskDetail>(`execution-tasks/${id}`, undefined, silent)
}

/**
 * 建一个 echo 工单，用来验证「网页下单 → 插件领活 → 回报结果」这条链路。
 */
export function createEchoTaskApi(data: CreateEchoTaskParams, silent = true) {
  return http.post<ExecutionTaskDetail>('execution-tasks/create-echo', data, silent)
}

/**
 * 取消工单，取消后设备领不到它。
 */
export function cancelExecutionTaskApi(id: string, silent = true) {
  return http.post<ExecutionTaskDetail>(`execution-tasks/${id}/cancel`, undefined, silent)
}

/**
 * 失败的工单重新排队，服务端会把已尝试次数归零。
 */
export function retryExecutionTaskApi(id: string, silent = true) {
  return http.post<ExecutionTaskDetail>(`execution-tasks/${id}/retry`, undefined, silent)
}
