import { createPaginationVo, createZodDto } from '@yikart/common'
import { LeanDoc, PublishedPost, PublishedPostLinkStatus, PublishedPostPublishStatus } from '@yikart/mongodb'
import { z } from 'zod'
import { SkippedMedia } from './draft-snapshot.service'

const PublishedPostBaseSchema = z.object({
  id: z.string().describe('发布记录 ID'),
  projectId: z.string().describe('属于哪个项目'),
  angleId: z.string().nullable().describe('属于哪个发布方向，归因用'),
  draftPath: z.string().describe('来源草稿目录，相对项目根'),
  platform: z.string().describe('平台标识'),
  accountId: z.string().nullable().describe('发到哪个号'),
  executionTaskId: z.string().nullable().describe('对应的执行工单'),
  // 两个状态分开：「发成功了但没抓到链接」是真实会发生的，合成一个就成了模糊地带
  publishStatus: z.enum(PublishedPostPublishStatus).describe('发布状态：pending / publishing / published / failed'),
  linkStatus: z.enum(PublishedPostLinkStatus).describe('链接状态：none / claimed / claim_failed'),
  platformPostId: z.string().nullable().describe('平台侧帖子 id'),
  postUrl: z.string().nullable().describe('帖子链接'),
  publishedAt: z.coerce.date().nullable().describe('发布时间'),
  failReason: z.string().nullable().describe('人工标记发失败时填的原因'),
  title: z.string().describe('快照标题，列表里直接显示'),
  mediaCount: z.number().int().describe('快照里有几张图'),
  createdAt: z.coerce.date().describe('创建时间'),
  updatedAt: z.coerce.date().describe('更新时间'),
})

const PublishedPostListItemVoSchema = PublishedPostBaseSchema
export class PublishedPostListItemVo extends createZodDto(PublishedPostListItemVoSchema, 'PublishedPostListItemVo') {}
export class PublishedPostListVo extends createPaginationVo(PublishedPostListItemVoSchema, 'PublishedPostListVo') {}

const PublishedPostSnapshotVoSchema = z.object({
  title: z.string().describe('标题'),
  body: z.string().describe('正文'),
  topics: z.array(z.string()).describe('话题，不带 #'),
  mediaUrls: z.array(z.string()).describe('图片 OSS 地址，取自名片文件'),
})

const PublishedPostDetailVoSchema = PublishedPostBaseSchema.extend({
  snapshot: PublishedPostSnapshotVoSchema.describe('点「准备发布」那一刻的内容快照'),
})
export class PublishedPostDetailVo extends createZodDto(PublishedPostDetailVoSchema, 'PublishedPostDetailVo') {}

const SkippedMediaVoSchema = z.object({
  path: z.string().describe('没进快照的图片：能定位到的是相对项目根的路径，路径不允许的那种是草稿里原样写的那一行'),
  reason: z
    .enum(['card_missing', 'oss_missing', 'path_not_allowed'])
    .describe('card_missing 名片读不到；oss_missing 名片在但没有 OSS 地址；path_not_allowed 这行指到 media/ 外面去了，压根没读'),
})

/** 建完工单返回：记录本身 + 这份草稿有哪些地方要人再看一眼 */
const PublishJobCreatedVoSchema = z.object({
  post: PublishedPostDetailVoSchema.describe('建出来的发布记录'),
  skippedMedia: z.array(SkippedMediaVoSchema).describe('没进快照的图片：找不到名片、名片里没有 OSS 地址，或者这行声明指到 media/ 外面去了'),
  mediaDeclared: z.boolean().describe('草稿里有没有声明配图；false 表示一张都没声明，图文平台要提示人补上再发'),
  bodyFallback: z.boolean().describe('正文是不是整篇原文兜出来的（草稿既没写 frontmatter 也没写 `## 正文` 小节）；true 时要提示人发之前自己删一遍'),
})
export class PublishJobCreatedVo extends createZodDto(PublishJobCreatedVoSchema, 'PublishJobCreatedVo') {}

const PublishedPostDeletedVoSchema = z.object({
  id: z.string().describe('已删除的发布记录 ID'),
  executionTaskId: z.string().nullable().describe('一并删掉的执行工单 ID'),
})
export class PublishedPostDeletedVo extends createZodDto(PublishedPostDeletedVoSchema, 'PublishedPostDeletedVo') {}

export type PublishedPostDoc = LeanDoc<PublishedPost>

function toBase(post: PublishedPostDoc) {
  return {
    id: post.id,
    projectId: post.projectId,
    angleId: post.angleId ?? null,
    draftPath: post.draftPath,
    platform: post.platform,
    accountId: post.accountId ?? null,
    executionTaskId: post.executionTaskId ?? null,
    publishStatus: post.publishStatus,
    linkStatus: post.linkStatus,
    platformPostId: post.platformPostId ?? null,
    postUrl: post.postUrl ?? null,
    publishedAt: post.publishedAt ?? null,
    failReason: post.failReason ?? null,
    title: post.snapshot?.title ?? '',
    mediaCount: post.snapshot?.mediaUrls?.length ?? 0,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  }
}

export function toPublishedPostListItemVo(post: PublishedPostDoc): PublishedPostListItemVo {
  return PublishedPostListItemVo.create(toBase(post))
}

export function toPublishedPostDetailVo(post: PublishedPostDoc): PublishedPostDetailVo {
  return PublishedPostDetailVo.create({
    ...toBase(post),
    snapshot: {
      title: post.snapshot?.title ?? '',
      body: post.snapshot?.body ?? '',
      topics: post.snapshot?.topics ?? [],
      mediaUrls: post.snapshot?.mediaUrls ?? [],
    },
  })
}

/** 建单时从草稿文件里读出来、但不落库的提示：只有这一刻说得清，列表里再看就没有了 */
export interface PublishJobDraftNotes {
  skippedMedia: SkippedMedia[]
  mediaDeclared: boolean
  bodyFallback: boolean
}

export function toPublishJobCreatedVo(post: PublishedPostDoc, notes: PublishJobDraftNotes): PublishJobCreatedVo {
  return PublishJobCreatedVo.create({
    post: toPublishedPostDetailVo(post),
    skippedMedia: notes.skippedMedia,
    mediaDeclared: notes.mediaDeclared,
    bodyFallback: notes.bodyFallback,
  })
}
