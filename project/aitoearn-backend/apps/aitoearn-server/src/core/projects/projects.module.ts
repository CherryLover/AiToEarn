import { Module } from '@nestjs/common'
import { ProjectDirService } from './project-dir.service'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectDirService],
  exports: [ProjectsService, ProjectDirService],
})
export class ProjectsModule {}
