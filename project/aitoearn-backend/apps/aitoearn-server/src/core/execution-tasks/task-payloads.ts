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

/**
 * 采集规格。**只允许选择器和正则，不允许任何可执行代码。**
 * 放在载荷里是为了平台改版时改服务端配置就行，不用发插件新版本；
 * 插件侧另有域名白名单，entryUrl 不在白名单里会被拒执行。
 */
const CollectSpecSchema = z.object({
  cardSelector: z.string().min(1).describe('一张作品卡的选择器'),
  titleSelector: z.string().min(1).describe('卡内标题'),
  timeSelector: z.string().min(1).describe('卡内发布时间'),
  statSelector: z.string().min(1).describe('卡内每个指标'),
  // 按图标指纹认指标，不按位置认：实测顺序是浏览/评论/点赞/收藏/分享，
  // 按位置读会把赞和评论对调，而且不报错、数字照样有
  metricByIconPrefix: z.record(z.string(), z.string()).describe('svg path 的 d 属性前缀 → 指标名'),
  totalCountPattern: z.string().optional().describe('「全部 65」这类标签的正则，第一个捕获组是总数'),
  maxScrolls: z.coerce.number().int().min(1).max(200).optional().describe('最多滚多少次'),
  scrollSettleMs: z.coerce.number().int().min(200).max(10000).optional().describe('每次滚完等多久'),
})

const SyncCreatorNotesPayloadSchema = z.object({
  platform: z.string().min(1).describe('哪个平台'),
  accountId: z.string().optional().describe('多号时区分'),
  entryUrl: z.url().describe('创作平台的作品列表页，插件侧会按白名单校验 host'),
  spec: CollectSpecSchema.describe('采集规格'),
})

const CollectedNoteSchema = z.object({
  title: z.string().describe('卡片上的标题'),
  titleTruncated: z.boolean().default(false).describe('标题是否被平台截断，截断了要用前缀匹配'),
  publishedAtText: z.string().describe('原样字符串，插件不转时区，由服务端按平台时区解析'),
  metrics: z.record(z.string(), z.number().int()).describe('按图标认出来的指标'),
})

export const SyncCreatorNotesResultSchema = z.object({
  collectedAt: z.coerce.date(),
  platform: z.string().min(1),
  accountHint: z.string().nullish().describe('页面上读到的账号名，对不对得上由服务端判断'),
  totalClaimed: z.number().int().nullish().describe('页面标签页声称的总数'),
  loadedCount: z.number().int().describe('实际加载到的卡片数'),
  reachedEnd: z.boolean().describe('是否确认滚到底'),
  notes: z.array(CollectedNoteSchema),
  // 图标指纹认不出来的整张卡放这里，不猜值
  unrecognized: z.array(z.object({
    title: z.string(),
    publishedAtText: z.string(),
    rawNumbers: z.array(z.string()).default([]),
    unknownPrefixes: z.array(z.string()).default([]),
  })).default([]),
  warnings: z.array(z.string()).default([]),
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
  [ExecutionTaskType.SYNC_CREATOR_NOTES]: SyncCreatorNotesPayloadSchema,
  [ExecutionTaskType.ECHO]: EchoPayloadSchema,
}

const RESULT_SCHEMAS: Record<ExecutionTaskType, z.ZodType> = {
  [ExecutionTaskType.PUBLISH]: PublishResultSchema,
  [ExecutionTaskType.CLAIM_LINK]: ClaimLinkResultSchema,
  [ExecutionTaskType.COLLECT_METRICS]: CollectMetricsResultSchema,
  [ExecutionTaskType.SYNC_CREATOR_NOTES]: SyncCreatorNotesResultSchema,
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
