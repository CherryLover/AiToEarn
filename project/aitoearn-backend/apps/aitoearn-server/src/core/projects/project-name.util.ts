import { AppException, ResponseCode } from '@yikart/common'

/**
 * 项目英文名规则（见 docs/rebuild/contract-core.md 第三节）：
 * 3~40 字符，小写字母开头，只含小写字母、数字、连字符，不以连字符结尾，且不允许连续连字符。
 */
export const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/

/** 保留字，另外任何以 `_` 或 `.` 开头的名字也一律拒绝 */
export const PROJECT_NAME_RESERVED = [
  'archived',
  'tmp',
  'temp',
  'system',
  'config',
  'node_modules',
] as const

/** 归档目录名前缀 */
export const ARCHIVED_DIR_PREFIX = '_archived_'

const SUGGEST_ADJECTIVES = [
  'brave',
  'bright',
  'calm',
  'clever',
  'cozy',
  'crisp',
  'eager',
  'fresh',
  'gentle',
  'happy',
  'humble',
  'lucky',
  'mellow',
  'merry',
  'noble',
  'quiet',
  'rapid',
  'shiny',
  'silent',
  'smart',
  'solid',
  'spry',
  'steady',
  'sunny',
  'swift',
  'tidy',
  'vivid',
  'warm',
  'wise',
  'zesty',
]

const SUGGEST_NOUNS = [
  'acorn',
  'anchor',
  'aspen',
  'badger',
  'beacon',
  'cedar',
  'comet',
  'coral',
  'crane',
  'dolphin',
  'ember',
  'falcon',
  'harbor',
  'heron',
  'lantern',
  'maple',
  'meadow',
  'otter',
  'panda',
  'pebble',
  'pilot',
  'quartz',
  'ridge',
  'river',
  'sparrow',
  'summit',
  'tiger',
  'walnut',
  'willow',
  'zebra',
]

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

/** 去掉首尾空白，其余原样保留，校验交给 assertProjectNameUsable */
export function normalizeProjectName(name: string): string {
  return name.trim()
}

/** 是否命中保留字（含以 `_` / `.` 开头的名字） */
export function isReservedProjectName(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.startsWith('_') || lower.startsWith('.'))
    return true

  return (PROJECT_NAME_RESERVED as readonly string[]).includes(lower)
}

/** 是否符合命名正则（含连续连字符检查） */
export function isValidProjectName(name: string): boolean {
  if (!PROJECT_NAME_PATTERN.test(name))
    return false

  return !name.includes('--')
}

/**
 * 校验项目英文名，不合法直接抛业务异常。
 * 先判保留字再判正则：`node_modules`、`_foo` 这类既命中保留字又不符合正则，给出更准确的提示。
 */
export function assertProjectNameUsable(name: string): void {
  if (isReservedProjectName(name))
    throw new AppException(ResponseCode.ProjectNameReserved)

  if (!isValidProjectName(name))
    throw new AppException(ResponseCode.ProjectNameInvalid)
}

/** 随机生成一个「形容词-名词」形式的可读英文名 */
export function randomProjectName(): string {
  return `${pick(SUGGEST_ADJECTIVES)}-${pick(SUGGEST_NOUNS)}`
}

/** 归档目录名：`_archived_<name>_<yyyyMMddHHmmss>` */
export function buildArchivedDirName(name: string, date: Date = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  const timestamp = [
    pad(date.getFullYear(), 4),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')

  return `${ARCHIVED_DIR_PREFIX}${name}_${timestamp}`
}
