import { createZodDto, PaginationDtoSchema } from '@yikart/common'
import { ExecutionTaskMode, PublishedPostLinkStatus, PublishedPostPublishStatus } from '@yikart/mongodb'
import { z } from 'zod'

/**
 * 从一份草稿建发布工单。
 *
 * **`mode` 这一轮只收 `manual`**：自动发布要执行端插件，插件是另一条线，还没有。
 * 这里把 `auto` 拒掉，而不是悄悄降级成 manual——悄悄降级会让人以为系统替他发了。
 */
const CreateFromDraftDtoSchema = z.object({
  draftPath: z.string().min(1).max(512).describe('草稿目录，相对项目根，如 drafts/2026-09-18-xhs-export-friction'),
  platform: z.string().min(1).max(40).describe('发到哪个平台，如 xhs'),
  accountId: z.string().max(64).optional().describe('发到哪个号；手动发布可以不填，你自己挑'),
  mode: z.enum(ExecutionTaskMode).describe('这一轮只接受 manual；传 auto 直接拒绝，自动发布要等插件'),
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
