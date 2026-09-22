/**
 * 运行时覆盖层的读法
 *
 * 配置现在是两层的（契约 `docs/rebuild/contract-runtime-config.md` 第三节）：
 *
 * ```
 * config.yaml（.env 渲染出来的基石）→ config.override.yaml（运行时覆盖层）→ zod 校验
 * ```
 *
 * 服务端 `GET config` 返回**合并后**的值，外加两份键路径清单：
 *
 * - `overriddenPaths`：这些路径当前的值来自覆盖层，也就是有人在网页上改过；
 * - `protectedPaths`：顶层「基石」键，只能从 `.env` 改，写进覆盖层会被直接拒（`ConfigOverrideProtectedKey`）。
 *
 * 这个文件只干一件事：把那两份字符串清单翻译成「某个 `ConfigPath` 现在是什么状态」。
 * 全是纯函数，不碰 React，方便单独验。
 *
 * ## 两条要留神的规矩
 *
 * 1. **老服务端不返回这两个字段**（后端可能还没升级），所以入口一律走
 *    `normalizeConfigPathList`：不是字符串数组就当空数组，页面照常显示，不许白屏。
 * 2. **数组是整体替换的**（契约 3.2），所以覆盖层里报的是数组自己的路径，
 *    不会逐项报。`isOverridden` 因此要认祖先前缀——数组整份来自覆盖层，里面每一项自然也是。
 */

import type { ConfigPath } from '../types'
import { getValueAtPath, joinPath, stableStringify } from './configPath'

/** 把服务端给的键路径清单收成干净的字符串数组。拿到任何不认识的东西都退化成空数组 */
export function normalizeConfigPathList(value: unknown): string[] {
  if (!Array.isArray(value))
    return []

  const seen = new Set<string>()
  value.forEach((item) => {
    if (typeof item !== 'string')
      return
    const trimmed = item.trim()
    if (trimmed)
      seen.add(trimmed)
  })

  return [...seen]
}

/** `'ai.models.chat.0'` → `['ai', 'models', 'chat', 0]`，纯数字段落转成下标 */
export function parseConfigPathKey(pathKey: string): ConfigPath {
  return pathKey
    .split('.')
    .filter(segment => segment.length > 0)
    .map(segment => (/^\d+$/.test(segment) ? Number(segment) : segment))
}

function isPathKeyPrefix(prefix: string, pathKey: string) {
  return pathKey === prefix || pathKey.startsWith(`${prefix}.`)
}

export interface ConfigOverrideMeta {
  /** 服务端原样给的清单，展示用（比如顶部那句话里列出受保护分区） */
  overriddenPaths: string[]
  protectedPaths: string[]
  /** 服务端到底给没给这两份清单：没给的时候不摆「全都能改」的架势 */
  available: boolean
  /** 这个路径的值现在是不是来自运行时覆盖层 */
  isOverridden: (path: ConfigPath) => boolean
  /** 这个子树里有几个路径来自覆盖层（含自己） */
  countOverridden: (path: ConfigPath) => number
  /** 这个路径是不是受保护的（自己是，或者祖先是） */
  isProtected: (path: ConfigPath) => boolean
  /** 是不是受保护子树的最外层：说明文字只在这一层讲一次，免得每个字段都念一遍 */
  isProtectedRoot: (path: ConfigPath) => boolean
}

export const emptyConfigOverrideMeta: ConfigOverrideMeta = {
  overriddenPaths: [],
  protectedPaths: [],
  available: false,
  isOverridden: () => false,
  countOverridden: () => 0,
  isProtected: () => false,
  isProtectedRoot: () => false,
}

export function createConfigOverrideMeta(input: {
  overriddenPaths?: unknown
  protectedPaths?: unknown
}): ConfigOverrideMeta {
  const overriddenPaths = normalizeConfigPathList(input.overriddenPaths)
  const protectedPaths = normalizeConfigPathList(input.protectedPaths)

  if (overriddenPaths.length === 0 && protectedPaths.length === 0)
    return emptyConfigOverrideMeta

  const overriddenSet = new Set(overriddenPaths)

  const isOverridden = (path: ConfigPath) => {
    const pathKey = joinPath(path)
    if (!pathKey)
      return false
    if (overriddenSet.has(pathKey))
      return true
    // 数组整体替换：数组自己在清单里，里面每一项也算覆盖来的
    return overriddenPaths.some(overriddenPath => isPathKeyPrefix(overriddenPath, pathKey))
  }

  const countOverridden = (path: ConfigPath) => {
    const pathKey = joinPath(path)
    if (!pathKey)
      return overriddenPaths.length
    return overriddenPaths.filter(overriddenPath => isPathKeyPrefix(pathKey, overriddenPath)).length
  }

  const isProtected = (path: ConfigPath) => {
    const pathKey = joinPath(path)
    if (!pathKey)
      return false
    return protectedPaths.some(protectedPath => isPathKeyPrefix(protectedPath, pathKey))
  }

  const isProtectedRoot = (path: ConfigPath) => {
    if (!isProtected(path))
      return false
    return !isProtected(path.slice(0, -1))
  }

  return {
    overriddenPaths,
    protectedPaths,
    available: true,
    isOverridden,
    countOverridden,
    isProtected,
    isProtectedRoot,
  }
}

/**
 * 找出「改到了受保护键上」的路径。
 *
 * 可视化表单里受保护字段是禁用的，改不动；但 JSON 模式是一整块文本，
 * 手改一个 `auth.secret` 完全可能。与其提交完等服务端回 `ConfigOverrideProtectedKey`，
 * 不如在这儿先拦一道，直接指名道姓说是哪个键——服务端那道拦截照旧留着，这只是提前说一声。
 */
export function findProtectedConfigChanges(
  config: Record<string, unknown>,
  originalConfig: Record<string, unknown> | null,
  protectedPaths: string[],
): string[] {
  if (!originalConfig || protectedPaths.length === 0)
    return []

  return protectedPaths.filter((protectedPath) => {
    const path = parseConfigPathKey(protectedPath)
    if (path.length === 0)
      return false

    const value = getValueAtPath(config, path)
    const originalValue = getValueAtPath(originalConfig, path)
    return stableStringify(value) !== stableStringify(originalValue)
  })
}
