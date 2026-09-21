import { Module } from '@nestjs/common'
import { ExecutionTasksModule } from '../execution-tasks/execution-tasks.module'
import { CreatorNoteIngestModule } from './creator-note-ingest.module'
import { CreatorNotesController } from './creator-notes.controller'
import { CreatorNotesScheduler } from './creator-notes.scheduler'
import { CreatorNotesService } from './creator-notes.service'

/** 建采集工单、查落地数据、数据页的那几个聚合，以及每 3 小时一轮的调度 */
@Module({
  imports: [ExecutionTasksModule, CreatorNoteIngestModule],
  controllers: [CreatorNotesController],
  providers: [CreatorNotesService, CreatorNotesScheduler],
  exports: [CreatorNotesService],
})
export class CreatorNotesModule {}
