import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, UserType } from '@yikart/common'
import { UpdateNotifySettingDto } from './settings-notify.dto'
import { SettingsNotifyService } from './settings-notify.service'
import { NotifySettingVo, NotifyTestResultVo } from './settings-notify.vo'

@ApiTags('Settings')
@Controller('/settings/notify')
export class SettingsNotifyController {
  constructor(private readonly settingsNotifyService: SettingsNotifyService) {}

  @ApiDoc({
    summary: '读通知配置',
    description: 'barkKey 只回掩码（形如 ••••abcd）和一个「已设置」标记，明文永远不回传',
    response: NotifySettingVo,
  })
  @Get('/')
  async get(
    @GetToken() token: TokenInfo,
  ): Promise<NotifySettingVo> {
    return await this.settingsNotifyService.get(token.id, UserType.User)
  }

  @ApiDoc({
    summary: '保存通知配置',
    description: 'barkKey 传空串表示不改；地址会先过一遍校验，指向内网或本机的一律拒绝',
    body: UpdateNotifySettingDto.schema,
    response: NotifySettingVo,
  })
  @Post('/')
  async save(
    @GetToken() token: TokenInfo,
    @Body() dto: UpdateNotifySettingDto,
  ): Promise<NotifySettingVo> {
    return await this.settingsNotifyService.save(token.id, UserType.User, dto)
  }

  @ApiDoc({
    summary: '发送测试通知',
    description: '用已保存的配置真发一条，标题写明是测试。先保存再测',
    response: NotifyTestResultVo,
  })
  @Post('/test')
  async test(
    @GetToken() token: TokenInfo,
  ): Promise<NotifyTestResultVo> {
    return await this.settingsNotifyService.sendTest(token.id, UserType.User)
  }
}
