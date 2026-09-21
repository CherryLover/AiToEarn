import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AppException } from '@yikart/common'
import { DeviceRepository, ExecutionTaskType } from '@yikart/mongodb'
import { listCollectPlatforms } from './collect-specs'
import { CreatorNotesService } from './creator-notes.service'

/**
 * 一轮最多看多少台设备。
 *
 * 只是给这一次扫描封顶，不是名额：设备按最后活跃时间倒序，排在后面的会在下一轮轮到。
 */
const MAX_DEVICES_PER_ROUND = 200

/**
 * 定时采集：每 3 小时一轮（contract-collect-xhs 第三节）。
 *
 * **从设备反查用户，而不是遍历用户**：名下根本没装插件的用户建出来的工单永远没人领，
 * 攒够 `maxAttempts` 之后集体变 failed，把工单列表冲成一片红。
 * 从设备出发的话，能建出工单就说明有一台机器声明了这个平台和 `job:sync_creator_notes`。
 */
@Injectable()
export class CreatorNotesScheduler {
  private readonly logger = new Logger(CreatorNotesScheduler.name)

  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly creatorNotesService: CreatorNotesService,
  ) {}

  @Cron(CronExpression.EVERY_3_HOURS)
  async dispatchSyncTasks(): Promise<void> {
    for (const platform of listCollectPlatforms())
      await this.dispatchForPlatform(platform)
  }

  private async dispatchForPlatform(platform: string): Promise<void> {
    const devices = await this.deviceRepository.listCapableDevices(
      [platform, `job:${ExecutionTaskType.SYNC_CREATOR_NOTES}`],
      MAX_DEVICES_PER_ROUND,
    )

    // 一个用户可能有好几台机器都登录着同一个平台，采一次就够
    const seen = new Set<string>()

    for (const device of devices) {
      if (seen.has(device.userId))
        continue
      seen.add(device.userId)

      try {
        await this.dispatchForUser(device.userId, platform, device.id)
      }
      catch (error) {
        // 一个用户建不出来不该让这一轮停住
        this.logger.warn(error, `给用户 ${device.userId} 建 ${platform} 采集工单失败`)
      }
    }
  }

  private async dispatchForUser(userId: string, platform: string, deviceId: string): Promise<void> {
    // 上一轮的还排着队（那台机器可能整天离线）就跳过这一轮。
    // 不看一眼的话，一周下来能攒出五十多个等着采同一份数据的工单
    const active = await this.creatorNotesService.countActiveSyncTasks(userId)
    if (active > 0) {
      this.logger.log(`用户 ${userId} 还有 ${active} 个采集工单没跑完，这一轮跳过`)
      return
    }

    try {
      const task = await this.creatorNotesService.createSyncTask(userId, { platform, targetDeviceId: deviceId })
      this.logger.log(`给用户 ${userId} 建了 ${platform} 采集工单 ${task.id}`)
    }
    catch (error) {
      // 没项目、没会干的机器这类是预期内的，用业务码说清楚就行，不用当异常记
      if (error instanceof AppException) {
        this.logger.log(`用户 ${userId} 这一轮不建 ${platform} 采集工单：${error.message}`)
        return
      }

      throw error
    }
  }
}
