import { Module } from '@nestjs/common'
import { DraftGenerationModule } from '../draft-generation/draft-generation.module'
import { DraftGenerationInternalController } from './draft-generation.controller'
import { ReadinessInternalController } from './readiness.controller'
import { ReadinessService } from './readiness.service'

@Module({
  imports: [
    DraftGenerationModule,
  ],
  providers: [
    ReadinessService,
  ],
  controllers: [
    DraftGenerationInternalController,
    ReadinessInternalController,
  ],
})
export class InternalModule {}
