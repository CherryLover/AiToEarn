import { Global, Module } from '@nestjs/common'
import { NotifySettingsService } from './notify-settings.service'
import { NotifyService } from './notify.service'

/**
 * 推送做成 @Global：哪个模块想推一条就直接注入 NotifyService，
 * 不用为了一行推送去改别人负责的模块的 imports。
 *
 * `NotifySettingsService` 要读 `userNotifySetting` 表，靠的是 `MongodbModule`（也是 @Global）
 * 导出的 `UserNotifySettingRepository`，所以这里不用再 imports 什么。
 */
@Global()
@Module({
  providers: [NotifySettingsService, NotifyService],
  exports: [NotifySettingsService, NotifyService],
})
export class NotifyModule {}
