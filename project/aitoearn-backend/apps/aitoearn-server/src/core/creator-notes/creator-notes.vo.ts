import { createPaginationVo, createZodDto } from '@yikart/common'
import {
  AngleMetricTotal,
  CreatorNoteMatchState,
  CreatorNoteRow,
  LeanDoc,
  PostMetric,
  PostMetricTrend,
} from '@yikart/mongodb'
import { z } from 'zod'

const MetricsVoSchema = z.object({
  views: z.number().describe('浏览'),
  comments: z.number().describe('评论'),
  likes: z.number().describe('点赞'),
  collects: z.number().describe('收藏'),
  shares: z.number().describe('分享'),
})

export const CreatorNoteRowVoSchema = z.object({
  id: z.string().describe('这一行的 id'),
  platform: z.string().describe('平台'),
  accountId: z.string().optional().describe('账号'),
  title: z.string().describe('卡片上的标题，原样'),
  titleTruncated: z.boolean().describe('标题被平台截断了，只能做前缀匹配'),
  publishedAtText: z.string().describe('卡片上的发布时间，原样'),
  publishedAt: z.coerce.date().optional().describe('按平台时区解析出来的时间，解析不了就没有这个字段'),
  metrics: MetricsVoSchema.describe('五个指标'),
  collectedAt: z.coerce.date().describe('采集时刻'),
  executionTaskId: z.string().optional().describe('哪个工单采的'),
  matchedPublishedPostId: z.string().optional().describe('归到哪条发布记录上'),
  matchState: z.enum([
    CreatorNoteMatchState.MATCHED,
    CreatorNoteMatchState.UNMATCHED,
    CreatorNoteMatchState.AMBIGUOUS,
  ]).describe('归属状态'),
  matchCandidates: z.array(z.string()).describe('ambiguous 时的候选，帖子 id 或草稿路径'),
})
export class CreatorNoteRowVo extends createZodDto(CreatorNoteRowVoSchema, 'CreatorNoteRowVo') {}
export class CreatorNoteRowListVo extends createPaginationVo(CreatorNoteRowVoSchema, 'CreatorNoteRowListVo') {}

export const PostMetricPointVoSchema = z.object({
  collectedAt: z.coerce.date().describe('采集时刻'),
  metrics: MetricsVoSchema.describe('那一刻的指标'),
})
export class PostMetricPointVo extends createZodDto(PostMetricPointVoSchema, 'PostMetricPointVo') {}

export const PostMetricTrendVoSchema = z.object({
  publishedPostId: z.string().describe('发布记录 id'),
  latest: MetricsVoSchema.describe('当前值'),
  delta: MetricsVoSchema.optional().describe('跟上一个采集点的差；只有一个采集点时没有这个字段'),
  latestCollectedAt: z.coerce.date().describe('当前值是什么时候采的'),
  snapshotCount: z.number().describe('这个窗口里有几个采集点'),
})
export class PostMetricTrendVo extends createZodDto(PostMetricTrendVoSchema, 'PostMetricTrendVo') {}

export const AngleMetricTotalVoSchema = z.object({
  angleId: z.string().optional().describe('方向 id；没挂方向的帖子汇总在没有这个字段的那一条里'),
  postCount: z.number().describe('这个方向下有几条帖子有数据'),
  totals: MetricsVoSchema.describe('每条帖子取最新那一条快照加起来'),
})
export class AngleMetricTotalVo extends createZodDto(AngleMetricTotalVoSchema, 'AngleMetricTotalVo') {}

export function toCreatorNoteRowVo(row: LeanDoc<CreatorNoteRow>) {
  return {
    id: row.id,
    platform: row.platform,
    accountId: row.accountId,
    title: row.title,
    titleTruncated: row.titleTruncated,
    publishedAtText: row.publishedAtText,
    publishedAt: row.publishedAt,
    metrics: row.metrics,
    collectedAt: row.collectedAt,
    executionTaskId: row.executionTaskId,
    matchedPublishedPostId: row.matchedPublishedPostId,
    matchState: row.matchState,
    matchCandidates: row.matchCandidates,
  }
}

export function toPostMetricPointVo(metric: LeanDoc<PostMetric>) {
  return { collectedAt: metric.collectedAt, metrics: metric.metrics }
}

export function toPostMetricTrendVo(trend: PostMetricTrend) {
  return {
    publishedPostId: trend.publishedPostId,
    latest: trend.latest,
    delta: trend.delta,
    latestCollectedAt: trend.latestCollectedAt,
    snapshotCount: trend.snapshotCount,
  }
}

export function toAngleMetricTotalVo(total: AngleMetricTotal) {
  return {
    angleId: total.angleId ?? undefined,
    postCount: total.postCount,
    totals: total.totals,
  }
}
