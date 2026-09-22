import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ResponseCode } from '../enums/response-code.enum'
import { AppException } from '../exceptions/app.exception'

/**
 * 运行时配置覆盖层。
 *
 * 读取优先级：`config.yaml`（.env 渲染出来的基石） → `config.override.yaml`（运行时可改） → zod 校验。
 *
 * 覆盖文件放在**基础配置文件旁边**，文件名是基础配置去掉扩展名之后加 `.override` 再加回原扩展名：
 * `/app/config.yaml` → `/app/config.override.yaml`，`/app/config.json` → `/app/config.override.json`。
 *
 * 之所以按基础配置路径推导，而不是另开一个环境变量或命令行参数：
 * 后端有「不读 `process.env`」这条规矩，基础配置路径本来就是 `-c` 传进来的唯一真相，
 * 从它推导出来的覆盖路径在容器里是固定的 `/app/config.override.yaml`，compose 直接挂这一个点即可。
 */

export type ConfigOverrideFormat = 'yaml' | 'json'

/**
 * 「基石」配置：改了要重建容器 / 重连中间件才有意义，只能从 `.env` 走，不接受运行时覆盖。
 * 这是**顶层键**白名单取反，其余顶层键全部可以覆盖。
 */
export const PROTECTED_CONFIG_KEYS: readonly string[] = Object.freeze([
  'port',
  'appDomain',
  'logger',
  'enableConfigLogging',
  'enableBadRequestDetails',
  'auth',
  'mongodb',
  'redis',
  'redlock',
  'assets',
  'serverClient',
  'projects',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => isDeepEqual(item, right[index]))
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) {
      return false
    }
    return leftKeys.every(key => key in right && isDeepEqual(left[key], right[key]))
  }

  return false
}

/** 由基础配置文件路径推导出覆盖文件路径，见本文件顶部说明 */
export function resolveConfigOverridePath(configPath: string): string {
  const extension = extname(configPath)
  const name = basename(configPath, extension)
  return join(dirname(configPath), `${name}.override${extension}`)
}

/** 覆盖文件只认 yaml / yml / json，和基础配置保持同一种格式 */
export function getConfigOverrideFormat(filePath: string): ConfigOverrideFormat {
  const lowerPath = filePath.toLowerCase()
  if (lowerPath.endsWith('.json')) {
    return 'json'
  }
  if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
    return 'yaml'
  }
  throw new AppException(ResponseCode.ConfigOverrideUnsupportedFormat, { path: filePath })
}

/**
 * 解析覆盖文件内容。空文件 / 只有注释的文件都算「没有覆盖」，返回 `{}`；
 * 解析不出来、或者根节点不是对象，才算读取失败。
 */
export function parseConfigOverrideContent(
  content: string,
  format: ConfigOverrideFormat,
): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = format === 'json' ? JSON.parse(content || '{}') : parseYaml(content)
  }
  catch (error) {
    throw new AppException(ResponseCode.ConfigOverrideReadFailed, {
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  if (parsed === null || parsed === undefined) {
    return {}
  }

  if (!isPlainObject(parsed)) {
    throw new AppException(ResponseCode.ConfigOverrideReadFailed, { reason: 'override root must be an object' })
  }

  return parsed
}

/**
 * 同步读覆盖文件；**文件不存在不算失败**，返回 `{}`，等于完全没有覆盖层。
 *
 * 路径存在但不是普通文件也按「没有覆盖层」处理：compose 单文件挂载时，宿主机上那个文件还没建出来，
 * Docker 会在容器里建成一个空目录，不能因为这个让服务起不来。
 */
export function readConfigOverrideFileSync(overridePath: string): Record<string, unknown> {
  if (!isReadableOverrideFile(overridePath)) {
    return {}
  }

  const format = getConfigOverrideFormat(overridePath)

  let content: string
  try {
    content = readFileSync(overridePath, 'utf-8')
  }
  catch (error) {
    throw new AppException(ResponseCode.ConfigOverrideReadFailed, {
      path: overridePath,
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  return parseConfigOverrideContent(content, format)
}

function isReadableOverrideFile(overridePath: string): boolean {
  try {
    return statSync(overridePath).isFile()
  }
  catch {
    return false
  }
}

function mergeValue(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const merged: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in base ? mergeValue(base[key], value) : value
    }
    return merged
  }
  // 数组和标量一律**整体替换**：模型清单这种东西，半个半个合起来没有意义
  return override
}

/** 深合并：对象递归合并，数组整体替换。base 不会被改动，返回的是新对象 */
export function mergeConfigOverride<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  return mergeValue(base, override) as T
}

/**
 * 列出一个配置对象里所有叶子键路径，形如 `agent.baseUrl`、`ai.models.chat`。
 * 数组是叶子（整体替换），空对象也是叶子（它本身就是被写下去的那个值）。
 */
export function collectConfigLeafPaths(value: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(child) && Object.keys(child).length > 0) {
      paths.push(...collectConfigLeafPaths(child, path))
    }
    else {
      paths.push(path)
    }
  }
  return paths
}

/**
 * 只留下和 base 不同的部分。
 *
 * 这样用户在网页上没动过的字段不会被冻结成一份同值副本——否则以后改 `.env` 会发现改不动了，
 * 因为覆盖层里压着一份陈旧的同值副本。
 *
 * base 有、next 没有的键会被忽略：覆盖层是「加法」，表达不了「删掉某个键」。
 */
export function diffConfigOverride(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}

  for (const [key, nextValue] of Object.entries(next)) {
    if (!(key in base)) {
      diff[key] = nextValue
      continue
    }

    const baseValue = base[key]
    if (isPlainObject(baseValue) && isPlainObject(nextValue)) {
      const childDiff = diffConfigOverride(baseValue, nextValue)
      if (Object.keys(childDiff).length > 0) {
        diff[key] = childDiff
      }
      continue
    }

    if (!isDeepEqual(baseValue, nextValue)) {
      diff[key] = nextValue
    }
  }

  return diff
}

/** 两份配置之间变了的**顶层键**，用来判断要不要触发热生效 */
export function diffTopLevelKeys(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  return [...keys].filter(key => !isDeepEqual(previous[key], next[key]))
}

/**
 * 找出覆盖层里触碰到受保护顶层键的具体键路径，形如 `['auth.secret', 'mongodb.uri']`。
 * 返回空数组表示没有违规。
 */
export function findProtectedConfigPaths(override: Record<string, unknown>): string[] {
  const paths: string[] = []
  // 按受保护清单本身的顺序走，输出顺序和提交对象的键顺序无关
  for (const key of PROTECTED_CONFIG_KEYS) {
    if (!(key in override)) {
      continue
    }
    const value = override[key]
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      paths.push(...collectConfigLeafPaths(value, key))
    }
    else {
      paths.push(key)
    }
  }
  return paths
}

/** 覆盖层里出现受保护键就抛，异常里逐个列出违规的键路径 */
export function assertNoProtectedConfigPaths(override: Record<string, unknown>): void {
  const paths = findProtectedConfigPaths(override)
  if (paths.length === 0) {
    return
  }
  throw new AppException(ResponseCode.ConfigOverrideProtectedKey, { paths })
}

/** 这份配置里实际存在的受保护顶层键，给网页禁用对应输入框用 */
export function listProtectedConfigPaths(config: Record<string, unknown>): string[] {
  return PROTECTED_CONFIG_KEYS.filter(key => key in config)
}
