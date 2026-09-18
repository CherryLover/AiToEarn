import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ExecutionTaskRepository } from '@yikart/mongodb'
import { ExecutionTasksService } from './execution-tasks.service'

/** 一轮最多回收多少条，避免一次扫太多把数据库压住 */
const REAP_BATCH_SIZE = 50

/**
 * 回收过期租约。
 *
 * 设备领了活之后要么干完回报，要么按时续租；两样都没做就说明它挂了、被关了或者网断了，
 * 这里把活收回来重新排队。退避见 computeBackoffSeconds，重试用尽转失败。
 */
@Injectable()
export class ExecutionTaskReaper {
  private readonly logger = new Logger(ExecutionTaskReaper.name)

  constructor(
    private readonly executionTaskRepository: ExecutionTaskRepository,
    private readonly executionTasksService: ExecutionTasksService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reclaimExpiredLeases() {
    const now = new Date()
    const expired = await this.executionTaskRepository.listByExpiredLease(now, REAP_BATCH_SIZE)
    if (expired.length === 0)
      return

    for (const task of expired) {
      try {
        const settled = await this.executionTasksService.reclaimExpired(task.id, now)
        if (settled)
          this.logger.log(`工单 ${task.id} 租约超时已回收，当前状态 ${settled.status}，已尝试 ${settled.attempts} 次`)
      }
      catch (error) {
        this.logger.error(error, `回收工单 ${task.id} 的过期租约失败`)
      }
    }
  }
}
