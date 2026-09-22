import type {
  Angle,
  AngleDeleted,
  AngleListParams,
  AngleTreeNode,
  ConfirmAnglesParams,
  CreateAngleParams,
  DeriveAngleParams,
  UpdateAngleParams,
} from './angle.types'
import http from '@/utils/request'

/**
 * 方向列表。
 * 不传 status 时不按状态筛；不传 confirmed 时已确认和待确认的一起返回，
 * `confirmed: true` 是页面上的正式列表，`confirmed: false` 是待确认区。
 */
export function getAngleListApi(projectId: string, params?: AngleListParams, silent = true) {
  return http.get<Angle[]>(`projects/${projectId}/angles/list`, params, silent)
}

/**
 * 采用一条待确认的方向：写上确认时间，它才会进列表、演进树和状态分组。
 * 幂等——已经采用过的再点一次不报错，确认时间也不会被刷新。
 */
export function confirmAngleApi(projectId: string, angleId: string, silent = true) {
  return http.post<Angle>(`projects/${projectId}/angles/${angleId}/confirm`, undefined, silent)
}

/**
 * 批量采用，待确认区的「全部采用」走这个。
 * 只要有一个 id 不属于当前项目，服务端整单拒绝，不会采用一半。
 */
export function confirmAnglesApi(projectId: string, data: ConfirmAnglesParams, silent = true) {
  return http.post<Angle[]>(`projects/${projectId}/angles/confirm`, data, silent)
}

/**
 * 方向演进树，服务端按 parentAngleId 组装好返回。只含已确认的方向。
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
 * 血统、sourceAssetPaths 也没人回填。返回的是登记之后这个项目的全部方向
 * （已确认的和待确认的都在里面）。
 *
 * 这里登记进来的方向一律是**待确认**：AI 一次提五个，好的坏的混着，
 * 直接进列表会把方向列表弄脏，得人在待确认区里点了采用才算数。
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
