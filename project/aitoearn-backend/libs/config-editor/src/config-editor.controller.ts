import { Body, Controller, Get, Post, Put } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ApiDoc } from '@yikart/common'
import { ConfigEditorConfigDto } from './config-editor.dto'
import { ConfigEditorService } from './config-editor.service'
import { ConfigEditorConfigVo } from './config-editor.vo'
import { ConfigRestartService } from './config-restart.service'

@ApiTags('ConfigEditor')
@Controller()
export class ConfigEditorController {
  constructor(
    private readonly configEditorService: ConfigEditorService,
    private readonly configRestartService: ConfigRestartService,
  ) {}

  @ApiDoc({
    summary: '获取配置文件',
    response: ConfigEditorConfigVo,
  })
  @Get()
  async getConfig(): Promise<ConfigEditorConfigVo> {
    return ConfigEditorConfigVo.create(await this.configEditorService.getConfig())
  }

  @ApiDoc({
    summary: '校验配置文件内容',
    body: ConfigEditorConfigDto.schema,
  })
  @Post('validate')
  async validateConfig(@Body() body: ConfigEditorConfigDto): Promise<void> {
    await this.configEditorService.validateConfig(body.config)
  }

  @ApiDoc({
    summary: '保存配置文件内容：只写运行时覆盖层，不碰基础配置文件',
    body: ConfigEditorConfigDto.schema,
  })
  @Put()
  async saveConfig(@Body() body: ConfigEditorConfigDto): Promise<void> {
    await this.configEditorService.saveConfig(body.config)
  }

  @ApiDoc({
    summary: '重启当前服务',
  })
  @Post('restart')
  restart(): void {
    this.configRestartService.restart()
  }
}
