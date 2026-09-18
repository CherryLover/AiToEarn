import { createPaginationVo, createZodDto } from '@yikart/common'
import { ExecutionTask, ExecutionTaskMode, ExecutionTaskStatus, ExecutionTaskType, LeanDoc } from '@yikart/mongodb'
import { z } from 'zod'

const ExecutionTaskBaseSchema = z.object({
  id: z.string().describe('工单 ID'),
  projectId: z.string().describe('属于哪个项目'),
  angleId: z.string().nullable().describe('属于哪个发布方向'),
  type: z.enum(ExecutionTaskType).describe('工单类型'),
  mode: z.enum(ExecutionTaskMode).describe('auto 走设备，manual 人工执行'),
  status: z.enum(ExecutionTaskStatus).describe('当前状态'),
  targetDeviceId: z.string().nullable().describe('指定必须由哪台设备执行'),
  deviceId: z.string().nullable().describe('当前（或最近一次）持有工单的设备'),
  requiredCapability: z.string().nullable().describe('需要的设备能力'),
  error: z.string().nullable().describe('失败原因'),
  attempts: z.number().int().describe('已尝试次数'),
  maxAttempts: z.number().int().describe('最大尝试次数'),
  availableAt: z.coerce.date().describe('到点才可领取'),
  leaseExpiresAt: z.coerce.date().nullable().describe('租约到期时间'),
  priority: z.number().int().describe('越小越先'),
  startedAt: z.coerce.date().nullable().describe('开始时间'),
  finishedAt: z.coerce.date().nullable().describe('结束时间'),
  createdAt: z.coerce.date().describe('创建时间'),
  updatedAt: z.coerce.date().describe('更新时间'),
})

const ExecutionTaskListItemVoSchema = ExecutionTaskBaseSchema
export class ExecutionTaskListItemVo extends createZodDto(ExecutionTaskListItemVoSchema, 'ExecutionTaskListItemVo') {}
export class ExecutionTaskListVo extends createPaginationVo(ExecutionTaskListItemVoSchema, 'ExecutionTaskListVo') {}

const ExecutionTaskDetailVoSchema = ExecutionTaskBaseSchema.extend({
  payload: z.record(z.string(), z.unknown()).describe('工单载荷，格式按类型'),
  result: z.record(z.string(), z.unknown()).nullable().describe('执行结果'),
})
export class ExecutionTaskDetailVo extends createZodDto(ExecutionTaskDetailVoSchema, 'ExecutionTaskDetailVo') {}

/** 设备领到活时拿到的东西。leaseId 只在这里给，续租和回报都要带回来 */
const ClaimedTaskVoSchema = z.object({
  id: z.string().describe('工单 ID'),
  type: z.enum(ExecutionTaskType).describe('工单类型'),
  projectId: z.string().describe('属于哪个项目'),
  payload: z.record(z.string(), z.unknown()).describe('工单载荷'),
  leaseId: z.string().describe('租约 id，续租和回报必须带上'),
  leaseExpiresAt: z.coerce.date().describe('租约到期时间，到点前要么干完要么续租'),
  attempts: z.number().int().describe('这是第几次尝试'),
  maxAttempts: z.number().int().describe('最多尝试几次'),
})
export class ClaimedTaskVo extends createZodDto(ClaimedTaskVoSchema, 'ClaimedTaskVo') {}

/** 没活可领时 task 为 null，不报错 */
const ClaimTaskResultVoSchema = z.object({
  task: ClaimedTaskVoSchema.nullable().describe('领到的工单，没有就是 null'),
})
export class ClaimTaskResultVo extends createZodDto(ClaimTaskResultVoSchema, 'ClaimTaskResultVo') {}

const TaskLeaseVoSchema = z.object({
  id: z.string().describe('工单 ID'),
  status: z.enum(ExecutionTaskStatus).describe('当前状态'),
  leaseExpiresAt: z.coerce.date().describe('租约到期时间'),
})
export class TaskLeaseVo extends createZodDto(TaskLeaseVoSchema, 'TaskLeaseVo') {}

const TaskReportedVoSchema = z.object({
  id: z.string().describe('工单 ID'),
  status: z.enum(ExecutionTaskStatus).describe('回报之后的状态'),
  attempts: z.number().int().describe('已尝试次数'),
  availableAt: z.coerce.date().describe('失败重排时表示下次可领取时间'),
})
export class TaskReportedVo extends createZodDto(TaskReportedVoSchema, 'TaskReportedVo') {}

type ExecutionTaskDoc = LeanDoc<ExecutionTask>

function toBase(task: ExecutionTaskDoc) {
  return {
    id: task.id,
    projectId: task.projectId,
    angleId: task.angleId ?? null,
    type: task.type,
    mode: task.mode,
    status: task.status,
    targetDeviceId: task.targetDeviceId ?? null,
    deviceId: task.deviceId ?? null,
    requiredCapability: task.requiredCapability ?? null,
    error: task.error ?? null,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    availableAt: task.availableAt,
    leaseExpiresAt: task.leaseExpiresAt ?? null,
    priority: task.priority,
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

export function toExecutionTaskListItemVo(task: ExecutionTaskDoc): ExecutionTaskListItemVo {
  return ExecutionTaskListItemVo.create(toBase(task))
}

export function toExecutionTaskDetailVo(task: ExecutionTaskDoc): ExecutionTaskDetailVo {
  return ExecutionTaskDetailVo.create({
    ...toBase(task),
    payload: task.payload ?? {},
    result: task.result ?? null,
  })
}

export function toClaimedTaskVo(task: ExecutionTaskDoc): ClaimedTaskVo {
  return ClaimedTaskVo.create({
    id: task.id,
    type: task.type,
    projectId: task.projectId,
    payload: task.payload ?? {},
    leaseId: task.leaseId ?? '',
    leaseExpiresAt: task.leaseExpiresAt ?? new Date(),
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
  })
}
