import { Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { AngleFileService } from './angle-file.service'
import { AnglesController } from './angles.controller'
import { AnglesService } from './angles.service'

@Module({
  // 项目归属校验和物料根目录都在 ProjectsModule 里，方向这边只用它导出的两个 service
  imports: [ProjectsModule],
  controllers: [AnglesController],
  providers: [AnglesService, AngleFileService],
  exports: [AnglesService],
})
export class AnglesModule {}
