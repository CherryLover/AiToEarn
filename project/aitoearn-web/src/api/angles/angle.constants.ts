/**
 * 发布方向（Angle）接口常量
 * 与服务端契约保持一致：slug 命名规则、字段长度、业务错误码、状态顺序。
 */

import { AngleStatus } from './angle.types'

/** slug 最短长度，规则同项目英文名 */
export const ANGLE_SLUG_MIN_LENGTH = 3

/** slug 最长长度，规则同项目英文名 */
export const ANGLE_SLUG_MAX_LENGTH = 40

/**
 * slug 正则：3~40 字符，小写字母开头，只含小写字母、数字、连字符，不以连字符结尾。
 * 另需单独排除连续连字符 `--`。规则同项目英文名，但 slug 允许修改。
 */
export const ANGLE_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/

/** slug 保留字，命中即拒绝，口径与项目英文名一致 */
export const ANGLE_SLUG_RESERVED_WORDS = [
  'archived',
  'tmp',
  'temp',
  'system',
  'config',
  'node_modules',
] as const

/** 方向显示名最长长度 */
export const ANGLE_NAME_MAX_LENGTH = 60

/** 方向说明最长长度 */
export const ANGLE_DESC_MAX_LENGTH = 500

/** 状态展示顺序：候选 → 测试中 → 有效 → 已淘汰 */
export const ANGLE_STATUS_ORDER = [
  AngleStatus.Candidate,
  AngleStatus.Testing,
  AngleStatus.Effective,
  AngleStatus.Retired,
] as const

/** 方向相关业务错误码，对应服务端 ResponseCode 20200 段 */
export const ANGLE_ERROR_CODE = {
  /** 方向不存在或不属于当前用户 */
  NotFound: 20200,
  /** slug 不符合命名规则 */
  SlugInvalid: 20201,
  /** slug 在项目里已存在 */
  SlugTaken: 20202,
  /** slug 命中保留字 */
  SlugReserved: 20203,
  /** 父方向不存在 */
  ParentNotFound: 20204,
  /** 不能把自己设成自己的父方向 */
  ParentSelf: 20205,
  /** 血统成环 */
  ParentCycle: 20206,
  /** 父方向属于别的项目 */
  ParentProjectMismatch: 20207,
  /** 方向已淘汰，不能再操作 */
  Retired: 20208,
  /** 状态值不合法 */
  StatusInvalid: 20209,
  /** 派生层数超过上限 */
  DepthExceeded: 20210,
  /** 名下还有子方向，不能删 */
  HasChildren: 20211,
  /** 方向不属于这个项目 */
  ProjectMismatch: 20212,
  /** angles/<slug>.md 不在了 */
  FileNotFound: 20213,
  /** 方向文件写入失败 */
  FileWriteFailed: 20214,
  /** 方向文件改名失败 */
  FileRenameFailed: 20215,
  /** 方向文件删除失败 */
  FileDeleteFailed: 20216,
  /** 方向文件内容不合法 */
  FileInvalid: 20217,
  /** AI 提炼方向失败 */
  ExtractionFailed: 20218,
  /** 草稿不存在 */
  DraftNotFound: 20219,
  /** 草稿生成失败 */
  DraftGenerateFailed: 20220,
  /** 草稿写入失败 */
  DraftWriteFailed: 20221,
  /** 草稿血缘信息不合法 */
  DraftMetaInvalid: 20222,
  /** 这个平台还不支持 */
  PlatformNotSupported: 20223,
} as const
