/**
 * 发布方向（Angle）接口类型
 * 字段严格对应服务端 AngleVo / AngleTreeNodeVo，
 * 不要在此处自行增删字段或改名。
 */

/**
 * 方向从哪来：AI 提炼、人手建、从别的方向派生。
 */
export enum AngleSource {
  Ai = 'ai',
  User = 'user',
  Derived = 'derived',
}

/**
 * 方向状态：候选 → 测试中 → 有效 / 已淘汰。
 */
export enum AngleStatus {
  Candidate = 'candidate',
  Testing = 'testing',
  Effective = 'effective',
  Retired = 'retired',
}

/**
 * Angle 数据结构，对应服务端 AngleVo。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
export interface Angle {
  id: string
  projectId: string
  /** 文件名用，项目内唯一，对应 angles/<slug>.md */
  slug: string
  name: string
  desc: string | null
  source: AngleSource
  /** 血统：从哪个方向派生来的，顶层方向为 null */
  parentAngleId: string | null
  status: AngleStatus
  /** AI 提炼时吃了哪些背景物料，相对项目根 */
  sourceAssetPaths: string[] | null
  /** 提炼时用的提示词 */
  promptSnapshot: string | null
  /**
   * 人确认采用的时间，缺省表示还在待确认区里等人看。
   * 服务端用的是可选字段（不是 null），没确认时这个键根本不会出现在响应里。
   */
  confirmedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * 方向演进树节点，对应服务端 /tree 的返回。
 */
export interface AngleTreeNode extends Angle {
  children: AngleTreeNode[]
}

/**
 * 列表查询参数。
 */
export interface AngleListParams {
  status?: AngleStatus
  /** 按确认与否筛：true 只要人已经采用的，false 只要待确认的，不传则全部 */
  confirmed?: boolean
}

/**
 * CreateAngleParams 请求参数，对应服务端 CreateAngleDto。
 * source 由服务端定为 user，parentAngleId 只能通过 derive 产生。
 */
export interface CreateAngleParams {
  slug: string
  name: string
  desc?: string
}

/**
 * UpdateAngleParams 请求参数，对应服务端 UpdateAngleDto。
 * 只改名字、说明、状态；slug 改名涉及文件改名，契约里没开放这个入口。
 */
export interface UpdateAngleParams {
  name?: string
  desc?: string
  status?: AngleStatus
}

/**
 * DeriveAngleParams 请求参数，对应服务端 DeriveAngleDto。
 * 父方向由路径上的 angleId 决定，不在请求体里传。
 */
export interface DeriveAngleParams {
  slug: string
  name: string
  desc?: string
}

/**
 * 批量采用请求参数，对应服务端 ConfirmAnglesDto。
 * 只要有一个 id 不属于当前项目，服务端整单拒绝，不会采用一半。
 */
export interface ConfirmAnglesParams {
  angleIds: string[]
}

/**
 * 删除接口返回，对应服务端 AngleDeletedVo。
 */
export interface AngleDeleted {
  id: string
}
