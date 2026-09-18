import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import {
  ExecutionTask,
  ExecutionTaskMode,
  ExecutionTaskRepository,
  ExecutionTaskStatus,
  ExecutionTaskType,
  LeanDoc,
  ListExecutionTasksParams,
} from '@yikart/mongodb'
import { customAlphabet } from 'nanoid'
import { config } from '../../config'
import { DeviceDoc } from '../devices/devices.service'
import { DeviceWsGateway } from './device-ws.gateway'
import { CreateEchoTaskDto, ReportTaskDto } from './execution-tasks.dto'
import { parseTaskPayload, parseTaskResult } from './task-payloads'

const generateLeaseId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 24)

/** 退避上限半小时 */
const MAX_BACKOFF_SECONDS = 1800

export type ExecutionTaskDoc = LeanDoc<ExecutionTask>

export interface CreateExecutionTaskParams {
  projectId: string
  type: ExecutionTaskType
  payload: unknown
  angleId?: string
  mode?: ExecutionTaskMode
  targetDeviceId?: string
  requiredCapability?: string
  priority?: number
  maxAttempts?: number
  availableAt?: Date
}

/**
 * 重试退避：min(60 * 2^attempts, 1800) 秒。
 * attempts 传的是**加一之后**的值，所以第一次失败等 120 秒，第二次 240 秒，封顶半小时。
 */
export function computeBackoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** attempts, MAX_BACKOFF_SECONDS)
}

@Injectable()
export class ExecutionTasksService {
  private readonly logger = new Logger(ExecutionTasksService.name)

  constructor(
    private readonly executionTaskRepository: ExecutionTaskRepository,
    private readonly gateway: DeviceWsGateway,
  ) {}

  // ========== 建单 ==========

  async create(userId: string, params: CreateExecutionTaskParams) {
    const payload = parseTaskPayload(params.type, params.payload)
    const availableAt = params.availableAt ?? new Date()

    const task = await this.executionTaskRepository.create({
      userId,
      userType: UserType.User,
      projectId: params.projectId,
      angleId: params.angleId,
      type: params.type,
      mode: params.mode ?? ExecutionTaskMode.AUTO,
      status: ExecutionTaskStatus.PENDING,
      targetDeviceId: params.targetDeviceId,
      requiredCapability: params.requiredCapability,
      payload,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? config.executionTask.maxAttempts,
      availableAt,
      priority: params.priority ?? 100,
    })

    this.notifyTaskAvailable(task)
    return task
  }

  /** 打通链路用的最小工单：设备原样返回 message 就算成 */
  async createEcho(userId: string, dto: CreateEchoTaskDto) {
    return await this.create(userId, {
      projectId: dto.projectId,
      type: ExecutionTaskType.ECHO,
      payload: { message: dto.message },
      mode: dto.mode,
      targetDeviceId: dto.targetDeviceId,
      requiredCapability: dto.requiredCapability,
      priority: dto.priority,
      maxAttempts: dto.maxAttempts,
      availableAt: dto.availableAt,
    })
  }

  // ========== 设备侧 ==========

  /**
   * 领一个活。领不到返回 null，不报错——没活干是常态，不是异常。
   * 原子性全在仓储层那一次 findOneAndUpdate 上，这里不加任何锁。
   */
  async claim(device: DeviceDoc): Promise<ExecutionTaskDoc | null> {
    const now = new Date()
    const leaseId = generateLeaseId()

    return await this.executionTaskRepository.updateAsLeasedByDevice({
      userId: device.userId,
      deviceId: device.id,
      capabilities: device.capabilities ?? [],
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + config.executionTask.leaseSeconds * 1000),
      now,
    })
  }

  /** 续租。leaseId 对不上或者租约已经过期一律拒绝 */
  async renew(device: DeviceDoc, id: string, leaseId: string) {
    const now = new Date()
    const renewed = await this.executionTaskRepository.updateLeaseExpiresAtByLease({
      id,
      deviceId: device.id,
      leaseId,
      leaseExpiresAt: new Date(now.getTime() + config.executionTask.leaseSeconds * 1000),
      now,
    })

    if (!renewed)
      await this.throwLeaseFailure(id, device, leaseId)

    return renewed!
  }

  /** 上报开始执行：leased → running */
  async start(device: DeviceDoc, id: string, leaseId: string) {
    const started = await this.executionTaskRepository.updateAsRunningByLease({
      id,
      deviceId: device.id,
      leaseId,
    })

    if (!started)
      await this.throwLeaseFailure(id, device, leaseId)

    return started!
  }

  /**
   * 回报结果。必须带 leaseId，对不上或者租约过期一律拒绝——
   * 过期租约的迟到结果绝不能覆盖后来者的成果，这是不重复执行的根本保证。
   */
  async report(device: DeviceDoc, id: string, dto: ReportTaskDto) {
    const task = await this.executionTaskRepository.getByIdAndUserId(id, device.userId)
    if (!task)
      throw new AppException(ResponseCode.ExecutionTaskNotFound)

    if (dto.success) {
      const result = parseTaskResult(task.type, dto.result)
      const succeeded = await this.executionTaskRepository.updateAsSucceededByLease({
        id,
        deviceId: device.id,
        leaseId: dto.leaseId,
        result,
      })

      if (!succeeded)
        await this.throwLeaseFailure(id, device, dto.leaseId)

      return succeeded!
    }

    const consumed = await this.executionTaskRepository.updateAsFailedAttemptByLease({
      id,
      deviceId: device.id,
      leaseId: dto.leaseId,
      error: dto.error?.trim() || '设备回报失败，没有给原因',
    })

    if (!consumed)
      await this.throwLeaseFailure(id, device, dto.leaseId)

    return await this.settleAfterFailure(consumed!)
  }

  // ========== 回收 ==========

  /**
   * 回收一条过期租约。返回 null 表示别的实例抢先处理了，不用管。
   * 吃租约那一步是原子的，所以后面重排 / 转失败不会被重复执行。
   */
  async reclaimExpired(id: string, now: Date = new Date()) {
    const consumed = await this.executionTaskRepository.updateAsFailedAttemptByExpiredLease(
      id,
      now,
      '租约超时没有续租，设备可能已经离线',
    )
    if (!consumed)
      return null

    return await this.settleAfterFailure(consumed, now)
  }

  // ========== 管理侧 ==========

  async listWithPagination(params: ListExecutionTasksParams) {
    return await this.executionTaskRepository.listWithPagination(params)
  }

  async getDetail(id: string, userId: string) {
    const task = await this.executionTaskRepository.getByIdAndUserId(id, userId)
    if (!task)
      throw new AppException(ResponseCode.ExecutionTaskNotFound)

    return task
  }

  async cancel(id: string, userId: string) {
    const cancelled = await this.executionTaskRepository.updateAsCancelledById(id, userId, new Date())
    if (cancelled)
      return cancelled

    await this.getDetail(id, userId)
    throw new AppException(ResponseCode.ExecutionTaskCancelNotAllowed)
  }

  /** 失败的重新排队，attempts 归零 */
  async retry(id: string, userId: string) {
    const retried = await this.executionTaskRepository.updateAsPendingForRetryById(id, userId, new Date())
    if (!retried) {
      await this.getDetail(id, userId)
      throw new AppException(ResponseCode.ExecutionTaskRetryNotAllowed)
    }

    this.notifyTaskAvailable(retried)
    return retried
  }

  /** 人工回填手动工单的结果 */
  async completeManual(id: string, userId: string, result: Record<string, unknown> | undefined) {
    const task = await this.getDetail(id, userId)
    if (task.mode !== ExecutionTaskMode.MANUAL)
      throw new AppException(ResponseCode.ExecutionTaskManualCompleteNotAllowed)

    const parsed = parseTaskResult(task.type, result)
    const completed = await this.executionTaskRepository.updateAsManuallySucceededById(id, userId, new Date(), parsed)
    if (!completed)
      throw new AppException(ResponseCode.ExecutionTaskStatusInvalid)

    return completed
  }

  // ========== 内部 ==========

  /**
   * 失败之后：没超上限就退避重排，超了转失败。
   *
   * 这一步跟前面「吃掉租约」之间隔着一次数据库往返，那个窗口里人可以把工单取消掉。
   * 两个写入都带了状态守卫（只认 leased / running），没命中就说明这条已经被取消，
   * 这时候什么都不改，按它现在的真实状态返回——绝不能把「已取消」抹回 pending 再发一遍。
   */
  private async settleAfterFailure(task: ExecutionTaskDoc, now: Date = new Date()) {
    const settled = task.attempts >= task.maxAttempts
      ? await this.executionTaskRepository.updateAsFailedById(task.id, now)
      : await this.executionTaskRepository.updateAsPendingById(
          task.id,
          new Date(now.getTime() + computeBackoffSeconds(task.attempts) * 1000),
        )

    if (settled)
      return settled

    this.logger.warn(`工单 ${task.id} 在结算失败前被取消或被别人处理了，保持现状`)
    return (await this.executionTaskRepository.getById(task.id)) ?? task
  }

  /**
   * 领取失败时把原因查清楚再报——领取本身没报错，是这一步的更新没命中。
   * 这里的读只为了给个准确的错误码，跟正确性无关。
   */
  private async throwLeaseFailure(id: string, device: DeviceDoc, leaseId: string): Promise<never> {
    const task = await this.executionTaskRepository.getByIdAndUserId(id, device.userId)
    if (!task)
      throw new AppException(ResponseCode.ExecutionTaskNotFound)

    if (task.deviceId !== device.id)
      throw new AppException(ResponseCode.ExecutionTaskNotLeasedByDevice)

    if (task.leaseId !== leaseId)
      throw new AppException(ResponseCode.ExecutionTaskLeaseInvalid)

    if (!task.leaseExpiresAt || new Date(task.leaseExpiresAt).getTime() <= Date.now())
      throw new AppException(ResponseCode.ExecutionTaskLeaseExpired)

    throw new AppException(ResponseCode.ExecutionTaskStatusInvalid)
  }

  /** 催办：只有现在就能被领走的 auto 工单才值得推 */
  private notifyTaskAvailable(task: ExecutionTaskDoc) {
    if (task.mode !== ExecutionTaskMode.AUTO || task.status !== ExecutionTaskStatus.PENDING)
      return

    if (new Date(task.availableAt).getTime() > Date.now())
      return

    try {
      this.gateway.notifyTaskAvailable({
        userId: task.userId,
        taskType: task.type,
        requiredCapability: task.requiredCapability ?? null,
        targetDeviceId: task.targetDeviceId ?? null,
      })
    }
    catch (error) {
      // 催办失败不影响任何事：设备定时来领照样领得到
      this.logger.warn(error, '推送 task_available 失败')
    }
  }
}
