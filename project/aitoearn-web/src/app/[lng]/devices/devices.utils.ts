/**
 * 设备页面工具函数
 * 只做纯计算：列表返回归一化、错误码到人话文案的映射、状态样式、时长与倒计时格式化。
 */

import type { ExecutionTaskListData, ExecutionTaskListItem } from '@/api/devices/execution-task.types'
import { DEVICE_CAPABILITY_LABEL_KEYS, DEVICE_ERROR_CODE } from '@/api/devices/device.constants'
import { EXECUTION_TASK_ERROR_CODE } from '@/api/devices/execution-task.constants'
import { ExecutionTaskStatus } from '@/api/devices/execution-task.types'
import { PROJECT_ERROR_CODE } from '@/api/projects/project.constants'

/** 还没跑完的状态，页面靠它决定要不要继续轮询 */
const ACTIVE_TASK_STATUSES: ExecutionTaskStatus[] = [
  ExecutionTaskStatus.Pending,
  ExecutionTaskStatus.Leased,
  ExecutionTaskStatus.Running,
]

/**
 * 工单列表返回的是分页包装，页面只认数组，这里统一取出来。
 */
export function normalizeExecutionTaskList(
  data: ExecutionTaskListData | null | undefined,
): ExecutionTaskListItem[] {
  if (!data || !Array.isArray(data.list))
    return []

  return data.list
}

/**
 * 把服务端错误码翻成 devices 命名空间下的文案键。
 * 请求本身失败（返回 null）时用 error.network，未知业务码用 error.unknown。
 */
export function getDeviceErrorKey(code?: string | number | null): string {
  if (code === undefined || code === null)
    return 'error.network'

  switch (Number(code)) {
    case DEVICE_ERROR_CODE.PairingCodeGenerateFailed:
      return 'error.pairingCodeGenerateFailed'
    case DEVICE_ERROR_CODE.NotFound:
      return 'error.deviceNotFound'
    case DEVICE_ERROR_CODE.Revoked:
      return 'error.deviceRevoked'
    case DEVICE_ERROR_CODE.Offline:
      return 'error.deviceOffline'
    case DEVICE_ERROR_CODE.NameInvalid:
      return 'error.deviceNameInvalid'
    case DEVICE_ERROR_CODE.LimitExceeded:
      return 'error.deviceLimitExceeded'
    case EXECUTION_TASK_ERROR_CODE.NotFound:
      return 'error.taskNotFound'
    case EXECUTION_TASK_ERROR_CODE.StatusInvalid:
      return 'error.taskStatusInvalid'
    case EXECUTION_TASK_ERROR_CODE.TypeNotSupported:
      return 'error.taskTypeNotSupported'
    case EXECUTION_TASK_ERROR_CODE.PayloadInvalid:
      return 'error.taskPayloadInvalid'
    case EXECUTION_TASK_ERROR_CODE.CreateFailed:
      return 'error.taskCreateFailed'
    case EXECUTION_TASK_ERROR_CODE.CancelNotAllowed:
      return 'error.taskCancelNotAllowed'
    case EXECUTION_TASK_ERROR_CODE.RetryNotAllowed:
      return 'error.taskRetryNotAllowed'
    case EXECUTION_TASK_ERROR_CODE.MaxAttemptsExceeded:
      return 'error.taskMaxAttemptsExceeded'
    case EXECUTION_TASK_ERROR_CODE.ProjectMismatch:
      return 'error.taskProjectMismatch'
    case PROJECT_ERROR_CODE.NotFound:
      return 'error.projectNotFound'
    case PROJECT_ERROR_CODE.Archived:
      return 'error.projectArchived'
    default:
      return 'error.unknown'
  }
}

/**
 * 已知能力返回文案键，没收录的返回 null，由调用方直接显示原始值。
 */
export function getCapabilityLabelKey(capability: string): string | null {
  return DEVICE_CAPABILITY_LABEL_KEYS[capability] ?? null
}

/**
 * 工单是否还在跑（待领取 / 已领取 / 执行中）。
 */
export function isActiveTask(status: ExecutionTaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.includes(status)
}

/**
 * 工单状态对应的徽标样式，沿用主题色，不引入新配色。
 */
export function getTaskStatusClassName(status: ExecutionTaskStatus): string {
  switch (status) {
    case ExecutionTaskStatus.Succeeded:
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case ExecutionTaskStatus.Failed:
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    case ExecutionTaskStatus.Running:
    case ExecutionTaskStatus.Leased:
      return 'border-brand-cyan/40 bg-brand-cyan/10 text-foreground'
    case ExecutionTaskStatus.Cancelled:
      return 'border-border bg-muted text-muted-foreground'
    case ExecutionTaskStatus.Pending:
    default:
      return 'border-border bg-muted/60 text-foreground'
  }
}

/**
 * 算耗时（秒）。没开始或还没结束都返回 null，交给调用方显示占位。
 */
export function getTaskDurationSeconds(
  startedAt: string | null,
  finishedAt: string | null,
): number | null {
  if (!startedAt || !finishedAt)
    return null

  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null

  return Math.round((end - start) / 1000)
}

/**
 * 秒数格式化成 mm:ss，用于配对码倒计时。
 */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * 距离某个时间点还剩几秒，已经过去就是 0。
 */
export function getRemainingSeconds(expiresAt: string | null | undefined): number {
  if (!expiresAt)
    return 0

  const end = new Date(expiresAt).getTime()
  if (!Number.isFinite(end))
    return 0

  return Math.max(0, Math.floor((end - Date.now()) / 1000))
}

/**
 * 载荷 / 结果这类自由结构原样转成可读 JSON，转不动就退回字符串。
 */
export function formatJsonBlock(value: unknown): string {
  if (value === null || value === undefined)
    return ''

  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}
