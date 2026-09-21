import type {
  AdoptCreatorNoteRowParams,
  AngleMetricTotal,
  CreateSyncTaskParams,
  CreatorNoteRow,
  CreatorNoteRowListData,
  GetCreatorNoteRowListParams,
  PostMetricPoint,
  PostMetricTrend,
  ProjectMetricsParams,
} from './creator-notes.types'
import type { ExecutionTaskDetail } from '@/api/devices/execution-task.types'
import http from '@/utils/request'

/**
 * 立刻采一次：建一个 sync_creator_notes 工单派给本机插件。
 * 采集规格由服务端下发，前端不传也不该传——规格里是选择器和图标指纹，写错了指标会静默串位。
 */
export function createSyncTaskApi(data: CreateSyncTaskParams, silent = true) {
  return http.post<ExecutionTaskDetail>('creator-notes/sync', data, silent)
}

/** 采回来的数据行，「未归属的帖子」那一块传 matchState=unmatched */
export function getCreatorNoteRowListApi(params?: GetCreatorNoteRowListParams, silent = true) {
  return http.get<CreatorNoteRowListData>('creator-notes/rows', params, silent)
}

/** 认领一行未归属的数据到某条发布记录上 */
export function claimCreatorNoteRowApi(id: string, publishedPostId: string, silent = true) {
  return http.post<CreatorNoteRow>(`creator-notes/rows/${id}/claim`, { publishedPostId }, silent)
}

/**
 * 把一行未归属的数据直接建成一条发布记录，并立刻归属过去。
 * 用在「这条内容是我自己做的，只是一开始没走系统」。
 */
export function adoptCreatorNoteRowApi(id: string, data: AdoptCreatorNoteRowParams, silent = true) {
  return http.post<CreatorNoteRow>(`creator-notes/rows/${id}/adopt`, data, silent)
}

/** 一条帖子的时间序列，早的在前 */
export function getPostMetricSeriesApi(publishedPostId: string, silent = true) {
  return http.get<PostMetricPoint[]>(`creator-notes/posts/${publishedPostId}/series`, undefined, silent)
}

/** 项目下每条帖子的当前值和趋势 */
export function getProjectMetricTrendsApi(
  projectId: string,
  params?: ProjectMetricsParams,
  silent = true,
) {
  return http.get<PostMetricTrend[]>(`creator-notes/projects/${projectId}/trends`, params, silent)
}

/** 按方向汇总，这才是整套设计的目的 */
export function getProjectAngleTotalsApi(
  projectId: string,
  params?: ProjectMetricsParams,
  silent = true,
) {
  return http.get<AngleMetricTotal[]>(`creator-notes/projects/${projectId}/angle-totals`, params, silent)
}
