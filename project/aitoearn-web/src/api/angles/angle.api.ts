import type {
  Angle,
  AngleDeleted,
  AngleListParams,
  AngleTreeNode,
  CreateAngleParams,
  DeriveAngleParams,
  UpdateAngleParams,
} from './angle.types'
import http from '@/utils/request'

/**
 * 方向列表，不传 status 时返回全部。
 */
export function getAngleListApi(projectId: string, params?: AngleListParams, silent = true) {
  return http.get<Angle[]>(`projects/${projectId}/angles/list`, params, silent)
}

/**
 * 方向演进树，服务端按 parentAngleId 组装好返回。
 * 页面上的树是用 list 自己组装的（一次请求同时够用于分组和树，改完状态也不用重拉），
 * 这里保留封装，给只要树、不要全量列表的场景用。
 */
export function getAngleTreeApi(projectId: string, silent = true) {
  return http.get<AngleTreeNode[]>(`projects/${projectId}/angles/tree`, undefined, silent)
}

/**
 * 手建一个方向，服务端同时写出 angles/<slug>.md。
 */
export function createAngleApi(projectId: string, data: CreateAngleParams, silent = true) {
  return http.post<Angle>(`projects/${projectId}/angles/create`, data, silent)
}

/**
 * 改方向的名字、说明、状态。
 */
export function updateAngleApi(
  projectId: string,
  angleId: string,
  data: UpdateAngleParams,
  silent = true,
) {
  return http.post<Angle>(`projects/${projectId}/angles/${angleId}/update`, data, silent)
}

/**
 * 从这个方向派生一个子方向，source=derived，parentAngleId 由服务端填。
 */
export function deriveAngleApi(
  projectId: string,
  angleId: string,
  data: DeriveAngleParams,
  silent = true,
) {
  return http.post<Angle>(`projects/${projectId}/angles/${angleId}/derive`, data, silent)
}

/**
 * 登记 AI 写出来的方向文件：扫 angles/ 下的 .md，把还没入库的方向补进数据库。
 *
 * AI 技能只管写文件，不写库。少了这一步，提炼出来的方向永远进不了列表，
 * 血统、sourceAssetPaths 也没人回填。返回的是登记之后这个项目的全部方向。
 */
export function syncAnglesApi(projectId: string, silent = true) {
  return http.post<Angle[]>(`projects/${projectId}/angles/sync`, undefined, silent)
}

/**
 * 删除方向，同时删掉 angles/<slug>.md。
 */
export function deleteAngleApi(projectId: string, angleId: string, silent = true) {
  return http.delete<AngleDeleted>(`projects/${projectId}/angles/${angleId}`, undefined, silent)
}
