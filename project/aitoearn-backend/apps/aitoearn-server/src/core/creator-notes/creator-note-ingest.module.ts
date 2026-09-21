import { Global, Module } from '@nestjs/common'
import { ProjectsModule } from '../projects/projects.module'
import { PublishingModule } from '../publishing/publishing.module'
import { CreatorNoteIngestService } from './creator-note-ingest.service'
import { CreatorNoteMatcherService } from './creator-note-matcher.service'
import { DraftTitleIndexService } from './draft-title-index.service'

/**
 * 入库那一半，单独做成 @Global。
 *
 * 采集结果是从 `ExecutionTasksService.report()` 进来的——所有工单都走那一个口子。
 * 要是把入库和建单、查询放在同一个模块里，那个模块得 import `ExecutionTasksModule`
 * （建采集工单要用），而 `ExecutionTasksService` 又要注入入库服务，两个模块互相 import。
 * 拆开之后依赖是单向的：入库这一半谁都不依赖，工单模块直接注入它。
 *
 * 跟 `NotifyModule` 同一个理由：接一个钩子不该逼别人改自己模块的 imports。
 */
@Global()
@Module({
  imports: [ProjectsModule, PublishingModule],
  providers: [CreatorNoteIngestService, CreatorNoteMatcherService, DraftTitleIndexService],
  exports: [CreatorNoteIngestService, CreatorNoteMatcherService],
})
export class CreatorNoteIngestModule {}
