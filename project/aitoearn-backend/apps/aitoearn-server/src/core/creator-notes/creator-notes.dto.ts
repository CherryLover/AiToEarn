import { createZodDto, PaginationDtoSchema } from '@yikart/common'
import { CreatorNoteMatchState } from '@yikart/mongodb'
import { z } from 'zod'
import { listCollectPlatforms } from './collect-specs'

const PlatformSchema = z.enum(listCollectPlatforms() as [string, ...string[]])

export const CreateSyncTaskDtoSchema = z.object({
  platform: PlatformSchema.describe('采哪个平台，目前只有 xhs'),
  accountId: z.string().max(128).optional().describe('多号时区分是哪个号'),
  projectId: z.string().optional().describe('工单挂在哪个项目下，不填取名下第一个项目；不影响数据归因'),
  targetDeviceId: z.string().optional().describe('指定哪台机器去采，不填自动挑一台声明了这个平台和 job:sync_creator_notes 的'),
})
export class CreateSyncTaskDto extends createZodDto(CreateSyncTaskDtoSchema, 'CreateSyncTaskDto') {}

export const CreatorNoteRowListQueryDtoSchema = PaginationDtoSchema.extend({
  platform: z.string().max(64).optional().describe('按平台筛'),
  accountId: z.string().max(128).optional().describe('按账号筛'),
  matchState: z.enum([
    CreatorNoteMatchState.MATCHED,
    CreatorNoteMatchState.UNMATCHED,
    CreatorNoteMatchState.AMBIGUOUS,
  ]).optional().describe('按归属状态筛，未归属的那一块传 unmatched'),
  matchedPublishedPostId: z.string().optional().describe('只看归到某条帖子上的行'),
  collectedFrom: z.coerce.date().optional().describe('采集时间下界'),
  collectedTo: z.coerce.date().optional().describe('采集时间上界'),
})
export class CreatorNoteRowListQueryDto extends createZodDto(CreatorNoteRowListQueryDtoSchema, 'CreatorNoteRowListQueryDto') {}

export const ClaimCreatorNoteRowDtoSchema = z.object({
  publishedPostId: z.string().min(1).describe('认领到哪条发布记录上'),
})
export class ClaimCreatorNoteRowDto extends createZodDto(ClaimCreatorNoteRowDtoSchema, 'ClaimCreatorNoteRowDto') {}

export const ProjectMetricsQueryDtoSchema = z.object({
  angleId: z.string().optional().describe('只看某个方向'),
  days: z.coerce.number().int().min(1).max(365).optional().describe('往回看多少天，默认 30'),
})
export class ProjectMetricsQueryDto extends createZodDto(ProjectMetricsQueryDtoSchema, 'ProjectMetricsQueryDto') {}
