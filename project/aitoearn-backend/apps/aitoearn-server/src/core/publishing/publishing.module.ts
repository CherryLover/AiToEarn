import { Module } from '@nestjs/common'
import { ExecutionTasksModule } from '../execution-tasks/execution-tasks.module'
import { ProjectsModule } from '../projects/projects.module'
import { DraftSnapshotService } from './draft-snapshot.service'
import { PublishingController } from './publishing.controller'
import { PublishingService } from './publishing.service'

@Module({
  // 项目归属校验和物料根目录在 ProjectsModule，建工单用 ExecutionTasksModule 导出的 service
  imports: [ProjectsModule, ExecutionTasksModule],
  controllers: [PublishingController],
  providers: [PublishingService, DraftSnapshotService],
  exports: [PublishingService],
})
export class PublishingModule {}
