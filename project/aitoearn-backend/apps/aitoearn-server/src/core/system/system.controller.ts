import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ApiDoc } from '@yikart/common'
import { SystemService } from './system.service'
import { AgentModelsVo, ReadinessVo } from './system.vo'

/**
 * 就绪检查（contract-runtime-config 4.1）。
 *
 * 没有 `@Public()`：全局守卫默认就要登录凭证，网页只在已登录布局里拉这个接口。
 * 检查结果里会带部署配置的缺失原因，不该给匿名访客看。
 */
@ApiTags('System')
@Controller('/system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @ApiDoc({
    summary: '就绪检查',
    description: '逐项检查部署有没有配全：agent 上游、对话模型、对象存储、物料根目录、推送。任何一项探不通都不抛错，结果写在 status 里',
    response: ReadinessVo,
  })
  @Get('/readiness')
  async getReadiness(): Promise<ReadinessVo> {
    const result = await this.systemService.getReadiness()
    return ReadinessVo.create(result)
  }

  @ApiDoc({
    summary: '上游有哪些模型',
    description: '给引导页的「默认模型」下拉用。按 agent.baseUrl 推出列模型接口去真问一次；拉不到也回 200，原因写在 detail 里',
    response: AgentModelsVo,
  })
  @Get('/agent-models')
  async getAgentModels(): Promise<AgentModelsVo> {
    const result = await this.systemService.getAgentModels()
    return AgentModelsVo.create(result)
  }
}
