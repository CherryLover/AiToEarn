import type { ConfigPath, ConfigValue } from '../types'
import { formatConfigKey, isRecord, stableStringify } from './configPath'

const sensitiveKeyPattern = /apiKey|key|secret|password|token|credential|accessKey/i

export function getLastStringSegment(path: ConfigPath, fallback: string) {
  const segment = [...path].reverse().find(item => typeof item === 'string')
  return typeof segment === 'string' ? segment : fallback
}

export function translateWithFallback(t: (key: string) => string, key: string, fallback: string) {
  const translated = t(key)
  return translated === key ? fallback : translated
}

export function getConfigFieldLabel(t: (key: string) => string, path: ConfigPath, fieldKey: string) {
  const key = getLastStringSegment(path, fieldKey)
  return translateWithFallback(t, `fields.${key}`, formatConfigKey(key))
}

export function isSensitiveConfigPath(path: ConfigPath) {
  return path.some(segment => typeof segment === 'string' && sensitiveKeyPattern.test(segment))
}

export function isConfigValueModified(value: ConfigValue, originalValue: ConfigValue) {
  return stableStringify(value) !== stableStringify(originalValue)
}

export function countLeafFields(value: unknown): number {
  if (Array.isArray(value)) {
    if (value.length === 0)
      return 1
    return value.reduce<number>((count, item) => count + countLeafFields(item), 0)
  }

  if (isRecord(value)) {
    const entries = Object.values(value)
    if (entries.length === 0)
      return 1
    return entries.reduce<number>((count, item) => count + countLeafFields(item), 0)
  }

  return 1
}

export function countModifiedLeafFields(value: unknown, originalValue: unknown): number {
  if (value === undefined && originalValue !== undefined)
    return countLeafFields(originalValue)

  if (Array.isArray(value)) {
    if (!Array.isArray(originalValue))
      return countLeafFields(value)
    if (value.length === 0)
      return isConfigValueModified(value, originalValue) ? 1 : 0

    const maxLength = Math.max(value.length, originalValue.length)
    let count = 0
    for (let index = 0; index < maxLength; index += 1)
      count += countModifiedLeafFields(value[index], originalValue[index])
    return count
  }

  if (isRecord(value)) {
    if (!isRecord(originalValue))
      return countLeafFields(value)

    const keys = new Set([...Object.keys(value), ...Object.keys(originalValue)])
    if (keys.size === 0)
      return isConfigValueModified(value, originalValue) ? 1 : 0

    let count = 0
    keys.forEach((key) => {
      count += countModifiedLeafFields(value[key], originalValue[key])
    })
    return count
  }

  return isConfigValueModified(value, originalValue) ? 1 : 0
}

/**
 * 取字段的说明文字。
 *
 * `configManager.json` 里 `fieldDescriptions` 的键有两种写法：光一个字段名（`port`），
 * 或者带路径（`agent.models`）。后者用 `t('fieldDescriptions.agent.models')` 是取不到的——
 * i18next 默认把点当层级分隔符，会去找不存在的嵌套对象。所以这里一次性拿整块对象再自己查。
 *
 * **只按完整路径查，单字段名那种写法只认顶层。**
 * 以前是「找不到就退回最后一段字段名」，结果是深层里任何一个叫 `channel` 的字段
 * 都会顶着「各平台 OAuth、回调、Logo…」这条说明——比如视频模型项里的 `channel: relay`。
 * 说明文字宁可空着，也不能给用户编一条不相干的。
 */
export function getConfigFieldDescription(
  descriptions: Record<string, string>,
  path: ConfigPath,
  fieldKey: string,
): string {
  const fullKey = path.filter((segment): segment is string => typeof segment === 'string').join('.')
  if (descriptions[fullKey])
    return descriptions[fullKey]

  if (path.length <= 1)
    return descriptions[getLastStringSegment(path, fieldKey)] || ''

  return ''
}
