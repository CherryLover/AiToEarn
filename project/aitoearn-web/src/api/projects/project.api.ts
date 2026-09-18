import type {
  CreateProjectParams,
  ProjectDetail,
  ProjectListItem,
  ProjectStatus,
  SuggestName,
  UpdateProjectParams,
} from './project.types'
import http from '@/utils/request'

/**
 * 创建项目。
 * 服务端会同时在物料根目录下建出项目目录，失败会整体回滚。
 */
export function createProjectApi(data: CreateProjectParams, silent = true) {
  return http.post<ProjectDetail>('projects/create', data, silent)
}

/**
 * 项目列表，不传 status 时返回全部。
 */
export function getProjectListApi(status?: ProjectStatus, silent = true) {
  return http.get<ProjectListItem[]>('projects/list', status ? { status } : undefined, silent)
}

/**
 * 项目详情。
 */
export function getProjectDetailApi(id: string, silent = true) {
  return http.get<ProjectDetail>(`projects/${id}`, undefined, silent)
}

/**
 * 更新项目可改字段，英文名 name 不可修改，不会被接口接受。
 */
export function updateProjectApi(id: string, data: UpdateProjectParams, silent = true) {
  return http.post<ProjectDetail>(`projects/${id}/update`, data, silent)
}

/**
 * 归档项目，服务端把目录改名为 _archived_<name>_<时间戳>，不删文件。
 */
export function archiveProjectApi(id: string, silent = true) {
  return http.post<ProjectDetail>(`projects/${id}/archive`, undefined, silent)
}

/**
 * 获取一个当前可用的建议英文名。
 */
export function suggestProjectNameApi(silent = true) {
  return http.get<SuggestName>('projects/suggest-name', undefined, silent)
}
