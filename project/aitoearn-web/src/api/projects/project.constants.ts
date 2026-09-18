/**
 * 项目（Project）接口常量
 * 与服务端契约保持一致：命名规则、保留字、业务错误码。
 */

/** 项目英文名最短长度 */
export const PROJECT_NAME_MIN_LENGTH = 3

/** 项目英文名最长长度 */
export const PROJECT_NAME_MAX_LENGTH = 40

/**
 * 项目英文名正则：3~40 字符，小写字母开头，只含小写字母、数字、连字符，不以连字符结尾。
 * 另需单独排除连续连字符 `--`。
 */
export const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/

/** 项目英文名保留字，命中即拒绝 */
export const PROJECT_NAME_RESERVED_WORDS = [
  'archived',
  'tmp',
  'temp',
  'system',
  'config',
  'node_modules',
] as const

/** 显示名最长长度 */
export const PROJECT_DISPLAY_NAME_MAX_LENGTH = 60

/** 一句话说明最长长度 */
export const PROJECT_DESC_MAX_LENGTH = 500

/** 面向谁最长长度 */
export const PROJECT_AUDIENCE_MAX_LENGTH = 200

/** 想达成什么最长长度 */
export const PROJECT_GOAL_MAX_LENGTH = 200

/** 项目相关业务错误码，对应服务端 ResponseCode 20000 段 */
export const PROJECT_ERROR_CODE = {
  /** 项目不存在或不属于当前用户 */
  NotFound: 20000,
  /** 英文名不符合命名规则 */
  NameInvalid: 20001,
  /** 英文名已存在 */
  NameTaken: 20002,
  /** 英文名命中保留字 */
  NameReserved: 20003,
  /** 物料目录创建失败 */
  DirCreateFailed: 20004,
  /** 项目已归档，不能操作 */
  Archived: 20005,
  /** 物料路径越界 */
  PathEscape: 20006,
  /** 物料目录改名失败（归档、归档回滚） */
  DirRenameFailed: 20007,
} as const
