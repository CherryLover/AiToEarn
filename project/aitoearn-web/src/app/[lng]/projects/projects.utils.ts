/**
 * 项目页面工具函数
 * 只做纯计算：英文名前端校验、服务端错误码到人话文案的映射。
 */

import { PROJECT_FILE_ERROR_CODE } from '@/api/projects/project-file.constants'
import {
  PROJECT_DISPLAY_NAME_MAX_LENGTH,
  PROJECT_ERROR_CODE,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_NAME_MIN_LENGTH,
  PROJECT_NAME_RESERVED_WORDS,
} from '@/api/projects/project.constants'

/** 只允许小写字母、数字、连字符 */
const ALLOWED_CHARS_PATTERN = /^[a-z0-9-]+$/

/** 是否命中保留字，判断口径与服务端一致：忽略大小写，另外 `_` / `.` 开头的一律算保留字 */
function isReservedProjectName(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('_') || lower.startsWith('.'))
    return true

  return (PROJECT_NAME_RESERVED_WORDS as readonly string[]).includes(lower)
}

/**
 * 校验项目英文名，返回 projects 命名空间下的文案键；合法时返回 null。
 * 规则与 contract-core 第三节、服务端校验保持一致。
 * 顺序也要和服务端一致：先判保留字，再判字符集 / 开头 / 结尾 / 长度 / 连续连字符，
 * 否则 `_foo`、`config` 这类名字两边给出的拒绝理由会对不上。
 */
export function validateProjectName(raw: string): string | null {
  const name = raw.trim()

  if (!name)
    return 'nameError.required'

  if (isReservedProjectName(name))
    return 'nameError.reserved'

  if (!ALLOWED_CHARS_PATTERN.test(name))
    return 'nameError.charset'

  if (!/^[a-z]/.test(name))
    return 'nameError.start'

  if (!/[a-z0-9]$/.test(name))
    return 'nameError.end'

  if (name.length < PROJECT_NAME_MIN_LENGTH || name.length > PROJECT_NAME_MAX_LENGTH)
    return 'nameError.length'

  if (name.includes('--'))
    return 'nameError.doubleHyphen'

  return null
}

/**
 * 校验显示名，返回 projects 命名空间下的文案键；合法时返回 null。
 */
export function validateProjectDisplayName(raw: string): string | null {
  const displayName = raw.trim()

  if (!displayName)
    return 'displayNameError.required'

  if (displayName.length > PROJECT_DISPLAY_NAME_MAX_LENGTH)
    return 'displayNameError.tooLong'

  return null
}

/**
 * 把服务端错误码翻成 projects 命名空间下的文案键。
 * 请求本身失败（返回 null）时用 error.network，未知业务码用 error.unknown。
 */
export function getProjectErrorKey(code?: string | number | null): string {
  if (code === undefined || code === null)
    return 'error.network'

  switch (Number(code)) {
    case PROJECT_ERROR_CODE.NotFound:
      return 'error.notFound'
    case PROJECT_ERROR_CODE.NameInvalid:
      return 'error.nameInvalid'
    case PROJECT_ERROR_CODE.NameTaken:
      return 'error.nameTaken'
    case PROJECT_ERROR_CODE.NameReserved:
      return 'error.nameReserved'
    case PROJECT_ERROR_CODE.DirCreateFailed:
      return 'error.dirCreateFailed'
    case PROJECT_ERROR_CODE.DirRenameFailed:
      return 'error.dirRenameFailed'
    case PROJECT_ERROR_CODE.Archived:
      return 'error.archived'
    case PROJECT_ERROR_CODE.PathEscape:
      return 'error.pathEscape'
    case PROJECT_FILE_ERROR_CODE.NotFound:
      return 'fileError.notFound'
    case PROJECT_FILE_ERROR_CODE.PathInvalid:
      return 'fileError.pathInvalid'
    case PROJECT_FILE_ERROR_CODE.TooLarge:
      return 'fileError.tooLarge'
    case PROJECT_FILE_ERROR_CODE.NotText:
      return 'fileError.notText'
    case PROJECT_FILE_ERROR_CODE.Exists:
      return 'fileError.exists'
    case PROJECT_FILE_ERROR_CODE.WriteFailed:
      return 'fileError.writeFailed'
    case PROJECT_FILE_ERROR_CODE.IsSymlink:
      return 'fileError.isSymlink'
    case PROJECT_FILE_ERROR_CODE.UploadFailed:
      return 'fileError.uploadFailed'
    default:
      return 'error.unknown'
  }
}
