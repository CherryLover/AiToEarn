import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Public } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { DeviceAuthGuard, GetDevice } from './device-auth.guard'
import { DeviceHeartbeatDto, PairDeviceDto } from './devices.dto'
import { DeviceDoc, DevicesService } from './devices.service'
import { DeviceHeartbeatVo, DevicePairedVo, toDeviceItemVo } from './devices.vo'

/**
 * 设备侧：浏览器插件用，走设备令牌，不走网页登录。
 *
 * 整个控制器挂 @Public()，是为了让全局的登录守卫（认 JWT）放行；
 * 真正的鉴权是下面每个接口上的 DeviceAuthGuard。配对接口本身没有令牌，所以不挂。
 */
@ApiTags('Devices/Device-API')
@Public()
@Controller('/device-api')
export class DeviceApiController {
  constructor(private readonly devicesService: DevicesService) {}

  @ApiDoc({
    summary: '用配对码换设备令牌',
    description: '这一个接口不需要令牌。明文令牌只在这里返回一次，丢了只能重新配对',
    body: PairDeviceDto.schema,
    response: DevicePairedVo,
  })
  @Post('/pair')
  async pair(
    @Body() dto: PairDeviceDto,
  ): Promise<DevicePairedVo> {
    const { device, token } = await this.devicesService.pair(dto)
    return DevicePairedVo.create({
      device: toDeviceItemVo(device, true),
      token,
    })
  }

  @ApiDoc({
    summary: '设备心跳',
    description: '刷新最后在线时间，顺带上报能力和已登录账号；默认 30 秒一次',
    body: DeviceHeartbeatDto.schema,
    response: DeviceHeartbeatVo,
  })
  @UseGuards(DeviceAuthGuard)
  @Post('/heartbeat')
  async heartbeat(
    @GetDevice() device: DeviceDoc,
    @Body() dto: DeviceHeartbeatDto,
  ): Promise<DeviceHeartbeatVo> {
    const result = await this.devicesService.heartbeat(device, dto)
    return DeviceHeartbeatVo.create(result)
  }
}
