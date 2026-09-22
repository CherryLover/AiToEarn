import { Module } from '@nestjs/common'
import { DraftGenerationModule } from '../draft-generation/draft-generation.module'
import { AgentModelsInternalController } from './agent-models.controller'
import { AgentModelsService } from './agent-models.service'
import { DraftGenerationInternalController } from './draft-generation.controller'
import { ReadinessInternalController } from './readiness.controller'
import { ReadinessService } from './readiness.service'

@Module({
  imports: [
    DraftGenerationModule,
  ],
  providers: [
    AgentModelsService,
    ReadinessService,
  ],
  controllers: [
    AgentModelsInternalController,
    DraftGenerationInternalController,
    ReadinessInternalController,
  ],
})
export class InternalModule {}
