import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Internal } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { ReadinessService } from './readiness.service'
import { InternalReadinessVo } from './readiness.vo'

@ApiTags('Internal/Readiness')
@Controller('internal')
@Internal()
export class ReadinessInternalController {
  constructor(
    private readonly readinessService: ReadinessService,
  ) {}

  @ApiDoc({
    summary: '就绪检查：ai 侧能判的项',
    description: '给 aitoearn-server 的 GET /system/readiness 用，真探一次 agent 上游；探不通也回 200，结果写在 status 里',
    response: InternalReadinessVo,
  })
  @Get('readiness')
  async listReadiness(): Promise<InternalReadinessVo> {
    const items = await this.readinessService.listItems()
    return InternalReadinessVo.create({ items })
  }
}
