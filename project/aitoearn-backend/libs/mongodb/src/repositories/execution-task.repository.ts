import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Pagination } from '@yikart/common'
import { FilterQuery, Model } from 'mongoose'
import {
  ExecutionTask,
  ExecutionTaskMode,
  ExecutionTaskStatus,
  ExecutionTaskType,
} from '../schemas'
import { BaseRepository } from './base.repository'

/** 这两个状态才持有租约 */
const LEASE_HOLDING_STATUSES = [ExecutionTaskStatus.LEASED, ExecutionTaskStatus.RUNNING]

export interface ClaimExecutionTaskParams {
  userId: string
  deviceId: string
  /** 设备自称有哪些能力 */
  capabilities: string[]
  leaseId: string
  leaseExpiresAt: Date
  now?: Date
}

export interface LeaseScopedParams {
  id: string
  deviceId: string
  leaseId: string
  now?: Date
}

export interface ListExecutionTasksParams extends Pagination {
  userId: string
  projectId?: string
  angleId?: string
  type?: ExecutionTaskType
  mode?: ExecutionTaskMode
  status?: ExecutionTaskStatus
  deviceId?: string
}

@Injectable()
export class ExecutionTaskRepository extends BaseRepository<ExecutionTask> {
  constructor(
    @InjectModel(ExecutionTask.name) executionTaskModel: Model<ExecutionTask>,
  ) {
    super(executionTaskModel)
  }

  /**
   * 领一个活：**一次原子的 findOneAndUpdate**。
   * 同一时刻只有一个设备能拿到同一个工单，靠数据库的单文档原子性保证，应用层不加任何锁。
   *
   * 过滤条件：
   * - 只有 pending + auto 的才进领取流程（manual 的设备根本看不见）
   * - availableAt 到点了才能领（排期和重试退避都用它）
   * - 指定了设备的工单只有那台设备能领，没指定的任意合格设备都能领
   * - 需要某项能力的工单，只有具备该能力的设备能领
   */
  async updateAsLeasedByDevice(params: ClaimExecutionTaskParams) {
    const now = params.now ?? new Date()

    const filter: FilterQuery<ExecutionTask> = {
      userId: params.userId,
      status: ExecutionTaskStatus.PENDING,
      mode: ExecutionTaskMode.AUTO,
      availableAt: { $lte: now },
      // $in 里带 null 同时匹配「字段不存在」和「字段是 null」
      targetDeviceId: { $in: [null, params.deviceId] },
      requiredCapability: { $in: [null, ...params.capabilities] },
    }

    return await this.updateOne(
      filter,
      {
        $set: {
          status: ExecutionTaskStatus.LEASED,
          deviceId: params.deviceId,
          leaseId: params.leaseId,
          leaseExpiresAt: params.leaseExpiresAt,
          startedAt: now,
        },
      },
      { sort: { priority: 1, availableAt: 1 }, new: true },
    )
  }

  /** 续租。leaseId 对不上或者租约已经过期一律返回 null */
  async updateLeaseExpiresAtByLease(params: LeaseScopedParams & { leaseExpiresAt: Date }) {
    const now = params.now ?? new Date()

    return await this.updateOne(
      this.buildLeaseFilter(params, now),
      { $set: { leaseExpiresAt: params.leaseExpiresAt } },
      { new: true },
    )
  }

  /** 上报开始执行：leased → running。同样要求租约有效 */
  async updateAsRunningByLease(params: LeaseScopedParams) {
    const now = params.now ?? new Date()

    return await this.updateOne(
      {
        ...this.buildLeaseFilter(params, now),
        status: ExecutionTaskStatus.LEASED,
      },
      { $set: { status: ExecutionTaskStatus.RUNNING } },
      { new: true },
    )
  }

  /** 回报成功。租约对不上或已过期返回 null，过期租约的迟到结果绝不会覆盖后来者的成果 */
  async updateAsSucceededByLease(params: LeaseScopedParams & { result?: Record<string, unknown> }) {
    const now = params.now ?? new Date()

    return await this.updateOne(
      this.buildLeaseFilter(params, now),
      {
        $set: {
          status: ExecutionTaskStatus.SUCCEEDED,
          result: params.result ?? {},
          finishedAt: now,
          error: null,
          leaseId: null,
          leaseExpiresAt: null,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    )
  }

  /**
   * 吃掉租约：原子地把 attempts + 1 并清空租约，返回更新之后的文档。
   * 返回 null 表示租约对不上或已过期，调用方应当拒绝这次回报。
   *
   * 「该重排还是该转失败」要读到 attempts，没法和这一步合成一条语句。
   * 这一步原子，所以同一个 leaseId 只可能有一个调用方走到后面那步；
   * 但两步之间还是有窗口，别人（人工取消）能插进来，
   * 所以后面那步必须带状态守卫，见 updateAsPendingById / updateAsFailedById。
   */
  async updateAsFailedAttemptByLease(params: LeaseScopedParams & { error: string }) {
    const now = params.now ?? new Date()

    return await this.updateOne(
      this.buildLeaseFilter(params, now),
      {
        $set: {
          error: params.error,
          leaseId: null,
          leaseExpiresAt: null,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    )
  }

  /**
   * 回收一条过期租约：同样是原子地 attempts + 1 并清空租约。
   * 多个实例同时扫到同一条时只有一个能成功，其余拿到 null。
   */
  async updateAsFailedAttemptByExpiredLease(id: string, now: Date, error: string) {
    return await this.updateOne(
      {
        _id: id,
        status: { $in: LEASE_HOLDING_STATUSES },
        leaseExpiresAt: { $lt: now },
      },
      {
        $set: {
          error,
          leaseId: null,
          leaseExpiresAt: null,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    )
  }

  /**
   * 退回待领取队列，退避到 availableAt 之后才能再被领走。
   *
   * **状态守卫不能省**：这一步紧跟在「吃掉租约」之后，中间隔着一次数据库往返，
   * 那个窗口里人可以把工单取消掉（取消接受 pending / leased / running）。
   * 按 _id 裸写就会把「已取消」抹回 pending，被取消的活重新排队再被执行一遍——
   * 对 publish 工单就是用户喊停之后帖子照发。
   * 这里只认「吃完租约之后本该有的状态」，命中不到说明这条已经被取消或被别人处理了，
   * 返回 null 保持现状。
   */
  async updateAsPendingById(id: string, availableAt: Date) {
    return await this.updateOne(
      { _id: id, status: { $in: LEASE_HOLDING_STATUSES } },
      {
        $set: {
          status: ExecutionTaskStatus.PENDING,
          availableAt,
          deviceId: null,
          leaseId: null,
          leaseExpiresAt: null,
          startedAt: null,
        },
      },
      { new: true },
    )
  }

  /** 重试用尽，转失败。状态守卫同上：已经被取消的不许改回失败 */
  async updateAsFailedById(id: string, finishedAt: Date) {
    return await this.updateOne(
      { _id: id, status: { $in: LEASE_HOLDING_STATUSES } },
      {
        $set: {
          status: ExecutionTaskStatus.FAILED,
          finishedAt,
          leaseId: null,
          leaseExpiresAt: null,
        },
      },
      { new: true },
    )
  }

  /** 人工取消。已经是终态的取消不了，返回 null */
  async updateAsCancelledById(id: string, userId: string, now: Date) {
    return await this.updateOne(
      {
        _id: id,
        userId,
        status: { $in: [ExecutionTaskStatus.PENDING, ...LEASE_HOLDING_STATUSES] },
      },
      {
        $set: {
          status: ExecutionTaskStatus.CANCELLED,
          finishedAt: now,
          leaseId: null,
          leaseExpiresAt: null,
        },
      },
      { new: true },
    )
  }

  /** 失败的重新排队，attempts 归零。不是失败态的返回 null */
  async updateAsPendingForRetryById(id: string, userId: string, availableAt: Date) {
    return await this.updateOne(
      { _id: id, userId, status: ExecutionTaskStatus.FAILED },
      {
        $set: {
          status: ExecutionTaskStatus.PENDING,
          attempts: 0,
          availableAt,
          deviceId: null,
          leaseId: null,
          leaseExpiresAt: null,
          startedAt: null,
          finishedAt: null,
          error: null,
          result: null,
        },
      },
      { new: true },
    )
  }

  /**
   * 人工回填手动工单的结果，直接转成功。
   *
   * 为什么连 `cancelled` 也认：手动发布允许「先标发失败（工单跟着取消），后来又真发出去了」
   * 这个顺序——发布记录本来就能从 failed 转 published。工单要是卡在 cancelled 转不回来，
   * 这条帖子在阶段 5 的统计里就是个黑洞，骨架第六节「手动发的也要有工单、能被统一统计」直接落空。
   * 手动工单没有设备在跑，把它从 cancelled 拉回 succeeded 不会让任何人重复执行。
   * 已经 succeeded / failed 的仍然不认，避免一条工单被登记两遍。
   */
  async updateAsManuallySucceededById(id: string, userId: string, now: Date, result: Record<string, unknown>) {
    return await this.updateOne(
      {
        _id: id,
        userId,
        mode: ExecutionTaskMode.MANUAL,
        status: { $in: [ExecutionTaskStatus.PENDING, ExecutionTaskStatus.CANCELLED] },
      },
      {
        $set: {
          status: ExecutionTaskStatus.SUCCEEDED,
          result,
          finishedAt: now,
          error: null,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    )
  }

  async getByIdAndUserId(id: string, userId: string) {
    return await this.findOne({ _id: id, userId })
  }

  /** 租约已经过期、还挂在 leased / running 上的工单 */
  async listByExpiredLease(now: Date, limit = 50) {
    return await this.find(
      {
        status: { $in: LEASE_HOLDING_STATUSES },
        leaseExpiresAt: { $lt: now },
      },
      { sort: { leaseExpiresAt: 1 }, limit },
    )
  }

  async listWithPagination(params: ListExecutionTasksParams) {
    const { page, pageSize, userId, projectId, angleId, type, mode, status, deviceId } = params

    const filter: FilterQuery<ExecutionTask> = {
      userId,
      ...(projectId ? { projectId } : {}),
      ...(angleId ? { angleId } : {}),
      ...(type ? { type } : {}),
      ...(mode ? { mode } : {}),
      ...(status ? { status } : {}),
      ...(deviceId ? { deviceId } : {}),
    }

    const [list, total] = await this.findWithPagination({
      page,
      pageSize,
      filter,
      options: { sort: { createdAt: -1 } },
    })

    return { list, total }
  }

  /** 租约作用域：必须是这台设备、这个 leaseId，而且租约还没过期 */
  private buildLeaseFilter(params: LeaseScopedParams, now: Date): FilterQuery<ExecutionTask> {
    return {
      _id: params.id,
      deviceId: params.deviceId,
      leaseId: params.leaseId,
      status: { $in: LEASE_HOLDING_STATUSES },
      leaseExpiresAt: { $gt: now },
    }
  }
}
