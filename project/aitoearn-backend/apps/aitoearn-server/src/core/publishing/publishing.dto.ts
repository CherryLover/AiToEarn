import { createZodDto, PaginationDtoSchema } from '@yikart/common'
import { ExecutionTaskMode, PublishedPostLinkStatus, PublishedPostPublishStatus } from '@yikart/mongodb'
import { z } from 'zod'

/**
 * 从一份草稿建发布工单。
 *
 * **`mode` 收 `auto` 和 `manual`**：传 auto 时服务端会先确认名下有设备同时声明了
 * 目标平台和 `job:publish` 能力，没有就直接拒绝，不悄悄降级成 manual。
 * 这里把 `auto` 拒掉，而不是悄悄降级成 manual——悄悄降级会让人以为系统替他发了。
 */
const CreateFromDraftDtoSchema = z.object({
  draftPath: z.string().min(1).max(512).describe('草稿目录，相对项目根，如 drafts/2026-09-18-xhs-export-friction'),
  platform: z.string().min(1).max(40).describe('发到哪个平台，如 xhs'),
  accountId: z.string().max(64).optional().describe('发到哪个号；手动发布可以不填，你自己挑'),
  mode: z.enum(ExecutionTaskMode).describe('auto 派给设备执行，需要有设备声明了对应能力；manual 打包给人自己发'),
})
export class CreateFromDraftDto extends createZodDto(CreateFromDraftDtoSchema, 'CreateFromDraftDto') {}

const PublishedPostListQueryDtoSchema = PaginationDtoSchema.extend({
  angleId: z.string().optional().describe('按发布方向筛'),
  platform: z.string().optional().describe('按平台筛'),
  publishStatus: z.enum(PublishedPostPublishStatus).optional().describe('按发布状态筛'),
  linkStatus: z.enum(PublishedPostLinkStatus).optional().describe('按链接状态筛'),
})
export class PublishedPostListQueryDto extends createZodDto(PublishedPostListQueryDtoSchema, 'PublishedPostListQueryDto') {}

/** 人工回填：你自己发完了，回来把链接贴进来 */
const CompletePublishedPostDtoSchema = z.object({
  postUrl: z.string().min(1).max(2048).describe('帖子链接，必须是 http:// 或 https:// 开头'),
  platformPostId: z.string().max(200).optional().describe('平台上的帖子 id；填了就能防同一条帖子被登记两次'),
})
export class CompletePublishedPostDto extends createZodDto(CompletePublishedPostDtoSchema, 'CompletePublishedPostDto') {}

const FailPublishedPostDtoSchema = z.object({
  reason: z.string().min(1).max(500).describe('发失败的原因，给自己看的'),
})
export class FailPublishedPostDto extends createZodDto(FailPublishedPostDtoSchema, 'FailPublishedPostDto') {}
