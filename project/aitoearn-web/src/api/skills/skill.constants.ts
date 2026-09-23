/** 自定义技能相关常量，与服务端契约一一对应（contract-custom-skills.md） */

/** 单个技能文件上限，和服务端 MAX_SKILL_FILE_BYTES 一致 */
export const MAX_SKILL_FILE_BYTES = 64 * 1024

/** 技能业务错误码，20900 段 */
export const SKILL_ERROR_CODE = {
  NameInvalid: 20900,
  NameReserved: 20901,
  FrontmatterMissing: 20902,
  FileTooLarge: 20903,
  FileInvalid: 20904,
  AlreadyExists: 20905,
  NotFound: 20906,
  BuiltinReadonly: 20907,
  StorageUnavailable: 20908,
} as const
