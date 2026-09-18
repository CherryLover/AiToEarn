import type {
  CompletePublishedPostParams,
  CreateFromDraftParams,
  FailPublishedPostParams,
  GetPublishedPostListParams,
  PublishedPostDeleted,
  PublishedPostDetail,
  PublishedPostListData,
  PublishJobCreated,
} from './publishing.types'
import http from '@/utils/request'

/**
 * 从一份草稿建发布工单：服务端读草稿、把内容快照下来，建一条发布记录 + 一条 manual 执行工单。
 * `mode` 只接受 `manual`，服务端拒绝 `auto`。这里不存在、也不会新增任何真正发内容到平台的接口。
 */
export function createPublishFromDraftApi(
  projectId: string,
  data: CreateFromDraftParams,
  silent = true,
) {
  return http.post<PublishJobCreated>(`projects/${projectId}/publishing/from-draft`, data, silent)
}

/**
 * 发布记录列表，可按发布状态 / 链接状态筛。
 */
export function getPublishedPostListApi(
  projectId: string,
  params?: GetPublishedPostListParams,
  silent = true,
) {
  return http.get<PublishedPostListData>(`projects/${projectId}/publishing/list`, params, silent)
}

/**
 * 发布记录详情，含完整内容快照。
 */
export function getPublishedPostDetailApi(projectId: string, id: string, silent = true) {
  return http.get<PublishedPostDetail>(`projects/${projectId}/publishing/${id}`, undefined, silent)
}

/**
 * 人工回填：自己在平台发完之后，把帖子链接填回来。
 * 记录转 published + claimed，对应工单转 succeeded。
 */
export function completePublishedPostApi(
  projectId: string,
  id: string,
  data: CompletePublishedPostParams,
  silent = true,
) {
  return http.post<PublishedPostDetail>(`projects/${projectId}/publishing/${id}/complete`, data, silent)
}

/**
 * 人工标记这条没发成功，填个原因。
 */
export function failPublishedPostApi(
  projectId: string,
  id: string,
  data: FailPublishedPostParams,
  silent = true,
) {
  return http.post<PublishedPostDetail>(`projects/${projectId}/publishing/${id}/fail`, data, silent)
}

/**
 * 删掉这条登记，只删记录和工单，草稿文件不动。
 */
export function deletePublishedPostApi(projectId: string, id: string, silent = true) {
  return http.delete<PublishedPostDeleted>(`projects/${projectId}/publishing/${id}`, undefined, silent)
}
