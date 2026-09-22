/**
 * 分步引导页的纯函数
 *
 * 只做计算：按键路径读写配置对象、判断一个字段能不能在网页上就地填、
 * 把服务端错误码翻成文案 key。**不发请求、不碰 React。**
 *
 * 一条安全约定：这个文件里没有一处 console。配置对象里带着 Key，
 * 顺手 `console.log(config)` 就等于把它打进浏览器控制台和任何接管了 console 的埋点。
 */

import type { SetupFieldSpec, SetupStepSpec } from './setup.constants'
import type { ReadinessItemVo } from '@/api/system/readiness.types'
import { ConfigEditorServiceTarget } from '@/api/config-editor/config-editor.types'
import {
  CONFIG_OVERRIDE_ERROR_CODE,
  PROTECTED_CONFIG_TOP_LEVEL_KEYS,
} from '@/api/system/readiness.constants'
import { ReadinessStatus } from '@/api/system/readiness.types'
import {
  PLACEHOLDER_SECRET_VALUES,
  SECRET_PATH_HINTS,
  SETUP_STEP_SPECS,
} from './setup.constants'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 按 `a.b.c` 读值，中途断了就返回 undefined */
export function getConfigValue(config: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current))
      return undefined
    return current[segment]
  }, config)
}

/**
 * 按 `a.b.c` 写值，返回**新对象**，原对象一个字节不动。
 * 只沿路径复制，其余分支共享引用——配置文件几千行，整份深拷贝没必要。
 */
export function setConfigValue(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.')
  const [head, ...rest] = segments
  const next: Record<string, unknown> = { ...config }

  if (rest.length === 0) {
    next[head] = value
    return next
  }

  const child = config[head]
  next[head] = setConfigValue(isRecord(child) ? child : {}, rest.join('.'), value)
  return next
}

/** 键路径的顶层键：`agent.baseUrl` → `agent` */
export function getTopLevelKey(path: string): string {
  return path.split('.')[0]
}

/**
 * 这个键路径是不是只能从部署环境改。
 *
 * **服务端给的 `protectedPaths` 优先**，它才是会真的拒绝保存的那一方；
 * 没给才退回本地兜底名单。反过来（本地优先）会在服务端放开某个键之后，
 * 让网页继续把一个其实能改的字段显示成不能改。
 */
export function isProtectedConfigPath(path: string, protectedPaths?: string[]): boolean {
  const topLevel = getTopLevelKey(path)
  const list: readonly string[] = protectedPaths?.length
    ? protectedPaths
    : PROTECTED_CONFIG_TOP_LEVEL_KEYS

  return list.some(protectedPath => protectedPath === topLevel || protectedPath === path)
}

/**
 * 这个值能不能用一个输入框填。
 * 数组和对象不行——`ai.models.chat` 是上百行的模型清单，塞进单行输入框只会毁掉它。
 * 这类字段引导页会把人指去配置管理页，而不是假装能改。
 */
export function isInlineEditableValue(value: unknown): boolean {
  return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** 看键路径像不像密钥，兜底渲染时用 */
export function isSecretPath(path: string): boolean {
  const last = path.split('.').pop()?.toLowerCase() ?? ''
  return SECRET_PATH_HINTS.some(hint => last.includes(hint))
}

/**
 * 这个密钥算不算「已经配好了」。
 * 空值和已知占位值都算没配——`sk-placeholder` 正是让「让 AI 提炼方向」一直报错的那个值，
 * 界面上必须显示成没配，不能显示成已设置。
 */
export function isSecretConfigured(value: unknown): boolean {
  if (typeof value !== 'string')
    return value != null && value !== ''

  const trimmed = value.trim()
  if (!trimmed)
    return false

  return !PLACEHOLDER_SECRET_VALUES.includes(trimmed.toLowerCase())
}

/** 把输入框里的字符串还原成原来的类型，免得把 `3000` 存成字符串把 schema 校验搞炸 */
export function coerceFieldValue(input: string, previous: unknown): unknown {
  if (typeof previous === 'number') {
    const parsed = Number(input)
    return Number.isFinite(parsed) ? parsed : input
  }
  if (typeof previous === 'boolean')
    return input.trim().toLowerCase() === 'true'
  return input
}

/**
 * 一个检查项落到哪一步。
 *
 * 认识的 key 用 `SETUP_STEP_SPECS` 里写死的那份；不认识的（服务端以后加的项）
 * 按 `configPath` 兜底渲染成一个通用输入框，猜一下它属于哪个服务、是不是密钥。
 * **宁可兜底渲染，也不要漏掉一项**：漏掉的那项会让用户填完所有步骤，横幅还挂着。
 */
export function resolveStepSpec(item: ReadinessItemVo): SetupStepSpec {
  const known = SETUP_STEP_SPECS.find(spec => spec.key === item.key)
  if (known)
    return known

  const path = item.configPath
  const topLevel = path ? getTopLevelKey(path) : ''
  // `agent.*` 和 `ai.*` 在 ai 服务的配置里，其余都在 server
  const target = topLevel === 'agent' || topLevel === 'ai'
    ? ConfigEditorServiceTarget.Ai
    : ConfigEditorServiceTarget.Server

  const fields: SetupFieldSpec[] = path
    ? [{ path, secret: isSecretPath(path), required: item.required }]
    : []

  return {
    key: item.key,
    target,
    // 兜底一律按「要重启」处理：多显示一个重启按钮不会错，
    // 漏了会让用户改完复检还是红的，却不知道为什么
    hotReload: false,
    fields,
  }
}

/**
 * 按契约 4.1 的顺序排检查项：已知的按 `SETUP_STEP_SPECS` 排，未知的追在后面。
 * 非必需项排到最后，免得让人以为它拦着自己。
 */
export function sortReadinessItems(items: ReadinessItemVo[]): ReadinessItemVo[] {
  const order = SETUP_STEP_SPECS.map(spec => spec.key)

  return [...items].sort((left, right) => {
    if (left.required !== right.required)
      return left.required ? -1 : 1

    const leftIndex = order.indexOf(left.key)
    const rightIndex = order.indexOf(right.key)
    if (leftIndex === rightIndex)
      return 0
    if (leftIndex === -1)
      return 1
    if (rightIndex === -1)
      return -1
    return leftIndex - rightIndex
  })
}

/** 还剩几个必需项没通过 */
export function countBlockingItems(items: ReadinessItemVo[]): number {
  return items.filter(item => item.required && item.status !== ReadinessStatus.Ok).length
}

/**
 * 保存失败时用哪句文案。
 * 命中 20800 段就用本地人话，没命中返回 null——调用方要显示服务端原始 message，
 * **不要包装成「稍后重试」**：真实原因比安慰话有用。
 */
export function getConfigOverrideErrorKey(code?: string | number): string | null {
  switch (code) {
    case CONFIG_OVERRIDE_ERROR_CODE.ProtectedKey:
      return 'save.error.protectedKey'
    case CONFIG_OVERRIDE_ERROR_CODE.WriteFailed:
      return 'save.error.writeFailed'
    case CONFIG_OVERRIDE_ERROR_CODE.ReadFailed:
      return 'save.error.readFailed'
    case CONFIG_OVERRIDE_ERROR_CODE.Invalid:
      return 'save.error.invalid'
    case CONFIG_OVERRIDE_ERROR_CODE.UnsupportedFormat:
      return 'save.error.unsupportedFormat'
    default:
      return null
  }
}

/**
 * 横幅上那句话说哪个检查项。
 * 挑第一个没通过的必需项——**说清楚坏的是哪个功能**，
 * 「AI 提炼方向现在用不了」比「配置缺失」有用得多（契约 4.2）。
 */
export function pickPrimaryBlockingItem(items: ReadinessItemVo[]): ReadinessItemVo | null {
  const blocking = sortReadinessItems(items).filter(
    item => item.required && item.status !== ReadinessStatus.Ok,
  )
  return blocking[0] ?? null
}

/** 认识这个检查项的 key 吗。不认识就用兜底文案，不要显示成一串英文 key */
export function isKnownItemKey(key: string): boolean {
  return SETUP_STEP_SPECS.some(spec => spec.key === key)
}
