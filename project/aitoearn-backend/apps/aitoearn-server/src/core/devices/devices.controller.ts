import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import { UpdateDeviceDto } from './devices.dto'
import { DevicesService } from './devices.service'
import { DeviceItemVo, PairingCodeVo, toDeviceItemVo } from './devices.vo'

/** 管理侧：网页登录后用，管自己名下的设备 */
@ApiTags('Devices')
@Controller('/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @ApiDoc({
    summary: '生成配对码',
    description: '把返回的码填进浏览器插件，插件拿它换一次性设备令牌；默认 10 分钟过期',
    response: PairingCodeVo,
  })
  @Post('/pairing-code')
  async createPairingCode(
    @GetToken() token: TokenInfo,
  ): Promise<PairingCodeVo> {
    const result = await this.devicesService.createPairingCode(token.id)
    return PairingCodeVo.create(result)
  }

  @ApiDoc({
    summary: '设备列表',
    description: '在线状态按最后一次心跳算，不看 WebSocket 连接',
    response: [DeviceItemVo],
  })
  @Get('/list')
  async list(
    @GetToken() token: TokenInfo,
  ): Promise<DeviceItemVo[]> {
    const devices = await this.devicesService.listByUserId(token.id)
    const now = new Date()
    return devices.map(device => toDeviceItemVo(device, this.devicesService.isOnline(device.lastSeenAt, now)))
  }

  @ApiDoc({
    summary: '改设备名',
    body: UpdateDeviceDto.schema,
    response: DeviceItemVo,
  })
  @Post('/:id/update')
  async update(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateDeviceDto,
  ): Promise<DeviceItemVo> {
    const device = await this.devicesService.rename(id, token.id, dto.name)
    return toDeviceItemVo(device, this.devicesService.isOnline(device.lastSeenAt))
  }

  @ApiDoc({
    summary: '吊销设备',
    description: '令牌立即失效，设备从列表里消失；已经领走的工单会在租约到期后被回收重排',
  })
  @Delete('/:id')
  async revoke(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.devicesService.revoke(id, token.id)
  }
}
