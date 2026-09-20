import { Module } from '@nestjs/common'
import { SettingsNotifyController } from './settings-notify.controller'
import { SettingsNotifyService } from './settings-notify.service'

/**
 * 设置页的后端（contract-settings 第四节）。
 *
 * 现在只有通知配置一块。个人资料和外观两块还在 user 模块和网页本地，
 * 这里不去动它们。
 */
@Module({
  controllers: [SettingsNotifyController],
  providers: [SettingsNotifyService],
  exports: [SettingsNotifyService],
})
export class SettingsModule {}
