import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Internal } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { AgentModelsService } from './agent-models.service'
import { InternalAgentModelsVo } from './agent-models.vo'

@ApiTags('Internal/AgentModels')
@Controller('internal')
@Internal()
export class AgentModelsInternalController {
  constructor(
    private readonly agentModelsService: AgentModelsService,
  ) {}

  @ApiDoc({
    summary: '上游有哪些模型',
    description: '按 agent.baseUrl 推出列模型接口去真问一次，给引导页的「默认模型」下拉用；拉不到也回 200，原因写在 detail 里',
    response: InternalAgentModelsVo,
  })
  @Get('agent-models')
  async listAgentModels(): Promise<InternalAgentModelsVo> {
    const result = await this.agentModelsService.listModels()
    return InternalAgentModelsVo.create(result)
  }
}
