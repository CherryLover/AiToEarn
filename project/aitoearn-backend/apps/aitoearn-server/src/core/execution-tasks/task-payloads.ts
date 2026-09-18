import { AppException, ResponseCode } from '@yikart/common'
import { ExecutionTaskType } from '@yikart/mongodb'
import { z } from 'zod'

/**
 * 各类工单的载荷与结果，照 contract-skeleton 第四节。
 * 建单时校验载荷、回报时校验结果，插件那条线照同一份实现。
 */

const PublishPayloadSchema = z.object({
  platform: z.string().min(1).describe('发到哪个平台'),
  accountId: z.string().min(1).describe('发到哪个号'),
  draftPath: z.string().optional().describe('草稿来源路径，仅供追溯'),
  // 必须用快照，不能只放路径：草稿在排队期间可能被改，
  // 发出去的应该是点「发布」那一刻的版本
  snapshot: z.object({
    title: z.string().describe('标题'),
    body: z.string().describe('正文'),
    topics: z.array(z.string()).default([]).describe('话题'),
    mediaUrls: z.array(z.string()).default([]).describe('图片 / 视频的 OSS 地址，插件直接下载'),
  }).describe('点发布那一刻的内容快照'),
})

const PublishResultSchema = z.object({
  platformPostId: z.string().nullish().describe('平台上的帖子 id，拿不到就留空，交给 claim_link'),
  postUrl: z.string().nullish().describe('帖子链接，同上'),
})

const ClaimLinkPayloadSchema = z.object({
  platform: z.string().min(1),
  accountId: z.string().min(1),
  publishedPostId: z.string().min(1).describe('对应的发布记录'),
  publishedAt: z.coerce.date().optional().describe('用来在列表里认哪条是它'),
  titleHint: z.string().optional().describe('辅助匹配'),
})

const ClaimLinkResultSchema = z.object({
  platformPostId: z.string().nullish(),
  postUrl: z.string().nullish(),
})

const CollectMetricsPayloadSchema = z.object({
  platform: z.string().min(1),
  accountId: z.string().min(1),
  publishedPostId: z.string().min(1),
  platformPostId: z.string().optional(),
  postUrl: z.string().optional(),
})

/** 取不到的指标留 null，不要填 0 冒充 */
const metricSchema = z.number().int().nullable()
const CollectMetricsResultSchema = z.object({
  views: metricSchema,
  likes: metricSchema,
  collects: metricSchema,
  comments: metricSchema,
  shares: metricSchema,
  collectedAt: z.coerce.date(),
})

const EchoPayloadSchema = z.object({
  message: z.string().describe('任意字符串'),
})

const EchoResultSchema = z.object({
  message: z.string().describe('原样返回'),
  deviceTime: z.coerce.date().describe('设备上的时间'),
})

const PAYLOAD_SCHEMAS: Record<ExecutionTaskType, z.ZodType> = {
  [ExecutionTaskType.PUBLISH]: PublishPayloadSchema,
  [ExecutionTaskType.CLAIM_LINK]: ClaimLinkPayloadSchema,
  [ExecutionTaskType.COLLECT_METRICS]: CollectMetricsPayloadSchema,
  [ExecutionTaskType.ECHO]: EchoPayloadSchema,
}

const RESULT_SCHEMAS: Record<ExecutionTaskType, z.ZodType> = {
  [ExecutionTaskType.PUBLISH]: PublishResultSchema,
  [ExecutionTaskType.CLAIM_LINK]: ClaimLinkResultSchema,
  [ExecutionTaskType.COLLECT_METRICS]: CollectMetricsResultSchema,
  [ExecutionTaskType.ECHO]: EchoResultSchema,
}

/** 建单时校验载荷跟类型对不对得上 */
export function parseTaskPayload(type: ExecutionTaskType, payload: unknown): Record<string, unknown> {
  const schema = PAYLOAD_SCHEMAS[type]
  if (!schema)
    throw new AppException(ResponseCode.ExecutionTaskTypeNotSupported)

  const parsed = schema.safeParse(payload)
  if (!parsed.success)
    throw new AppException(ResponseCode.ExecutionTaskPayloadInvalid)

  return parsed.data as Record<string, unknown>
}

/** 回报成功时校验结果。回报失败时没有结果，不用校验 */
export function parseTaskResult(type: ExecutionTaskType, result: unknown): Record<string, unknown> {
  const schema = RESULT_SCHEMAS[type]
  if (!schema)
    throw new AppException(ResponseCode.ExecutionTaskTypeNotSupported)

  const parsed = schema.safeParse(result ?? {})
  if (!parsed.success)
    throw new AppException(ResponseCode.ExecutionTaskResultInvalid)

  return parsed.data as Record<string, unknown>
}
