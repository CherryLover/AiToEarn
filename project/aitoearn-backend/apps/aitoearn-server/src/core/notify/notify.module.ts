import { Global, Module } from '@nestjs/common'
import { NotifyService } from './notify.service'

/**
 * 推送做成 @Global：哪个模块想推一条就直接注入 NotifyService，
 * 不用为了一行推送去改别人负责的模块的 imports。
 */
@Global()
@Module({
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
