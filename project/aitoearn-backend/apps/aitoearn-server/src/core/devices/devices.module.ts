import { Module } from '@nestjs/common'
import { DeviceApiController } from './device-api.controller'
import { DeviceAuthGuard } from './device-auth.guard'
import { DevicesController } from './devices.controller'
import { DevicesService } from './devices.service'

@Module({
  controllers: [DevicesController, DeviceApiController],
  providers: [DevicesService, DeviceAuthGuard],
  // 工单模块的设备侧接口和 WebSocket 网关都要用这套设备鉴权
  exports: [DevicesService, DeviceAuthGuard],
})
export class DevicesModule {}
