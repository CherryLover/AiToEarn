import { Module } from '@nestjs/common'
import { ProjectDirService } from './project-dir.service'
import { ProjectFilesService } from './project-files.service'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectDirService, ProjectFilesService],
  exports: [ProjectsService, ProjectDirService, ProjectFilesService],
})
export class ProjectsModule {}
