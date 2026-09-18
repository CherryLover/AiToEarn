/**
 * 项目（Project）接口类型
 * 字段严格对应服务端 ProjectDetailVo / ProjectListItemVo / SuggestNameVo，
 * 不要在此处自行增删字段或改名。
 */

/**
 * 项目状态。
 */
export enum ProjectStatus {
  Active = 'active',
  Archived = 'archived',
}

/**
 * ProjectDetail 数据结构，对应服务端 ProjectDetailVo。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
export interface ProjectDetail {
  id: string
  /** 英文名/目录名，创建后不可修改 */
  name: string
  displayName: string
  desc: string | null
  audience: string | null
  goal: string | null
  status: ProjectStatus
  /** 磁盘上的实际目录名，归档后为 _archived_<name>_<yyyyMMddHHmmss> */
  dirName: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * ProjectListItem 数据结构，对应服务端 ProjectListItemVo。
 */
export interface ProjectListItem {
  id: string
  name: string
  displayName: string
  desc: string | null
  status: ProjectStatus
  createdAt: string
}

/**
 * SuggestName 数据结构，对应服务端 SuggestNameVo。
 */
export interface SuggestName {
  /** 一个当前可用的建议英文名 */
  name: string
}

/**
 * CreateProjectParams 请求参数，对应服务端 CreateProjectDto。
 */
export interface CreateProjectParams {
  /** 项目英文名，同时是目录名，创建后不可修改 */
  name: string
  displayName: string
  desc?: string
  audience?: string
  goal?: string
}

/**
 * UpdateProjectParams 请求参数，对应服务端 UpdateProjectDto。
 * 不包含 name：英文名创建后永久不可修改。
 */
export interface UpdateProjectParams {
  displayName?: string
  desc?: string
  audience?: string
  goal?: string
}
