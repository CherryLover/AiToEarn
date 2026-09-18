import { createZodDto, PaginationDtoSchema } from '@yikart/common'
import { ExecutionTaskMode, ExecutionTaskStatus, ExecutionTaskType } from '@yikart/mongodb'
import { z } from 'zod'

// ========== 设备侧 ==========

const RenewTaskDtoSchema = z.object({
  leaseId: z.string().min(1).describe('领取时拿到的租约 id，对不上一律拒绝'),
})
export class RenewTaskDto extends createZodDto(RenewTaskDtoSchema, 'RenewTaskDto') {}

const StartTaskDtoSchema = z.object({
  leaseId: z.string().min(1).describe('领取时拿到的租约 id'),
})
export class StartTaskDto extends createZodDto(StartTaskDtoSchema, 'StartTaskDto') {}

const ReportTaskDtoSchema = z.object({
  leaseId: z.string().min(1).describe('领取时拿到的租约 id，对不上一律拒绝'),
  success: z.boolean().describe('干成了没有'),
  result: z.record(z.string(), z.unknown()).optional().describe('成功时的结果，格式按工单类型'),
  error: z.string().max(2000).optional().describe('失败原因，给人看的'),
})
export class ReportTaskDto extends createZodDto(ReportTaskDtoSchema, 'ReportTaskDto') {}

// ========== 管理侧 ==========

const CreateEchoTaskDtoSchema = z.object({
  projectId: z.string().min(1).describe('属于哪个项目'),
  message: z.string().min(1).max(500).default('ping').describe('随便写点什么，设备会原样返回'),
  mode: z.enum(ExecutionTaskMode).default(ExecutionTaskMode.AUTO).describe('auto 走设备，manual 不进领取流程'),
  targetDeviceId: z.string().optional().describe('指定必须由哪台设备执行，不传表示任意合格设备'),
  requiredCapability: z.string().optional().describe('需要设备具备的能力'),
  priority: z.coerce.number().int().min(0).max(1000).default(100).describe('越小越先'),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional().describe('最大尝试次数，不传用配置里的默认值'),
  availableAt: z.coerce.date().optional().describe('到点才可领取，不传表示立刻'),
})
export class CreateEchoTaskDto extends createZodDto(CreateEchoTaskDtoSchema, 'CreateEchoTaskDto') {}

const ExecutionTaskListQueryDtoSchema = PaginationDtoSchema.extend({
  projectId: z.string().optional().describe('按项目筛'),
  angleId: z.string().optional().describe('按发布方向筛'),
  type: z.enum(ExecutionTaskType).optional().describe('按类型筛'),
  mode: z.enum(ExecutionTaskMode).optional().describe('按模式筛'),
  status: z.enum(ExecutionTaskStatus).optional().describe('按状态筛'),
  deviceId: z.string().optional().describe('按执行设备筛'),
})
export class ExecutionTaskListQueryDto extends createZodDto(ExecutionTaskListQueryDtoSchema, 'ExecutionTaskListQueryDto') {}

const CompleteManualTaskDtoSchema = z.object({
  result: z.record(z.string(), z.unknown()).optional().describe('人工回填的结果，格式按工单类型'),
})
export class CompleteManualTaskDto extends createZodDto(CompleteManualTaskDtoSchema, 'CompleteManualTaskDto') {}
