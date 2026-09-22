/**
 * 配置管理页工具函数
 *
 * 两部分：
 * 1. relay 占位节点的补全/剔除——从原弹窗 `app/layout/ConfigManagerDialog/index.tsx` 原样搬过来的逻辑；
 * 2. 失败原因的提取——**这块是这次新写的，而且是这一版的重点**。
 *
 * ## 关于失败原因
 *
 * 这个页面的保存在当前部署里是必然失败的：容器把 `config/server.yaml` 以 `:ro` 挂进去，
 * 服务端写不动。用户知道它会失败，他要看的是**为什么**。所以这里的规矩是：
 *
 * - 服务端说了什么就显示什么，一个字不改、不翻译、不美化；
 * - 服务端没说原因，就明说「服务端只回了错误码，没有给原因」，并且把错误码显示出来；
 * - 请求压根没到服务端，就说这一条；
 * - **任何情况下都不许落到「网络繁忙，请稍后重试」这种话上。**
 *
 * 最后一条需要特别处理：`utils/request/client.ts` 在 `code !== 0` 且服务端没给 message 时，
 * 会把 message 顶掉成 `common.networkBusy`。那句话在这里是假的——请求通了，是服务端拒绝了。
 * 所以下面会把这句兜底文案识别出来，当成「没有原因」处理。
 */

import type { ConfigPath } from './types'
import { ConfigEditorServiceTarget } from '@/api/config-editor/config-editor.types'
import { directTrans } from '@/app/i18n/client'
import { getValueAtPath, isRecord, stableStringify } from './utils/configPath'

/** 接口返回的信封，只取这里用得到的三个字段 */
export interface ConfigApiResponseLike {
  code: string | number
  message?: string
  data?: unknown
}

const serverRelayPath: ConfigPath = ['relay']
const aiRelayPath: ConfigPath = ['ai', 'relay']
const serverRelayDefaultConfig: Record<string, unknown> = {
  serverUrl: '',
  apiKey: '',
  callbackUrl: '',
}
const aiRelayDefaultConfig: Record<string, unknown> = {
  url: '',
  apiKey: '',
  timeout: 300000,
}

export function isConfigEditorServiceTarget(value: string): value is ConfigEditorServiceTarget {
  return value === ConfigEditorServiceTarget.Server || value === ConfigEditorServiceTarget.Ai
}

export function formatJsonConfig(config: Record<string, unknown>) {
  return JSON.stringify(config, null, 2)
}

function getRelayPath(serviceTarget: ConfigEditorServiceTarget): ConfigPath {
  return serviceTarget === ConfigEditorServiceTarget.Ai ? aiRelayPath : serverRelayPath
}

function getRelayDefaultConfig(serviceTarget: ConfigEditorServiceTarget) {
  return serviceTarget === ConfigEditorServiceTarget.Ai
    ? { ...aiRelayDefaultConfig }
    : { ...serverRelayDefaultConfig }
}

/** 配置文件里没有 relay 节点时，补一个可编辑的空占位 */
export function ensureRelayConfig(config: Record<string, unknown>, serviceTarget: ConfigEditorServiceTarget) {
  const relayPath = getRelayPath(serviceTarget)
  if (getValueAtPath(config, relayPath) !== undefined) {
    return { config, insertedRelayPath: null }
  }

  if (serviceTarget === ConfigEditorServiceTarget.Ai) {
    const aiConfig = config.ai
    if (!isRecord(aiConfig)) {
      return { config, insertedRelayPath: null }
    }

    return {
      config: {
        ...config,
        ai: {
          ...aiConfig,
          relay: getRelayDefaultConfig(serviceTarget),
        },
      },
      insertedRelayPath: relayPath,
    }
  }

  return {
    config: {
      ...config,
      relay: getRelayDefaultConfig(serviceTarget),
    },
    insertedRelayPath: relayPath,
  }
}

function removeValueAtPath(source: Record<string, unknown>, path: ConfigPath): Record<string, unknown> {
  const [segment, ...remainingPath] = path
  if (typeof segment !== 'string')
    return source

  const nextSource = { ...source }
  if (remainingPath.length === 0) {
    delete nextSource[segment]
    return nextSource
  }

  const nestedValue = nextSource[segment]
  if (!isRecord(nestedValue))
    return nextSource

  nextSource[segment] = removeValueAtPath(nestedValue, remainingPath)
  return nextSource
}

/** 补出来的 relay 占位没被改过就别提交，免得给配置文件凭空加一节 */
export function stripInsertedRelayPlaceholder(
  config: Record<string, unknown>,
  insertedRelayPath: ConfigPath | null,
  serviceTarget: ConfigEditorServiceTarget,
) {
  if (!insertedRelayPath)
    return config

  const relayValue = getValueAtPath(config, insertedRelayPath)
  if (stableStringify(relayValue) !== stableStringify(getRelayDefaultConfig(serviceTarget)))
    return config

  return removeValueAtPath(config, insertedRelayPath)
}

export interface ConfigApiFailure {
  /** 服务端错误码；请求没到服务端时是 null */
  code: string | number | null
  /** 服务端原话，没给就是空串 */
  reason: string
  /** 细项，比如校验失败时逐条的 zod issue */
  details: string[]
}

function getIssueText(issue: Record<string, unknown>) {
  const message = typeof issue.message === 'string' ? issue.message.trim() : ''
  const path = Array.isArray(issue.path)
    ? issue.path
        .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
        .join('.')
    : ''

  if (path && message)
    return `${path}: ${message}`
  return message || path
}

/** 服务端列违规键路径时可能用的几种字段名。多认几个不亏，少认一个就少显示一条关键信息 */
const failureKeyListFields = ['keys', 'paths', 'protectedKeys', 'protectedPaths', 'invalidKeys']

/** 一串纯字符串的键路径，比如受保护键被拒时逐个列出来的那些 */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

/**
 * 把服务端 data 里的细项摊成一行一条。
 *
 * 两种形态都认：
 * - zod 那种 `issues: [{ path, message }]`（校验失败走这条）；
 * - 一串键路径（`ConfigOverrideProtectedKey` 会逐个列出违规的键，见契约 3.3）。
 *   服务端用哪个字段名装这串键还没定死，所以几个常见名字都试一遍，
 *   实在没有就退回把 `data` 本身当字符串数组读——宁可多认，不能把「是哪个键」这条信息弄丢。
 */
function readFailureDetails(data: unknown): string[] {
  if (Array.isArray(data))
    return readStringList(data)

  if (!isRecord(data))
    return []

  if (Array.isArray(data.issues)) {
    return data.issues
      .map(issue => (isRecord(issue) ? getIssueText(issue) : ''))
      .filter((detail): detail is string => detail.length > 0)
  }

  for (const field of failureKeyListFields) {
    const keys = readStringList(data[field])
    if (keys.length > 0)
      return keys
  }

  return []
}

/**
 * `client.ts` 在服务端没给 message 时会塞 `common.networkBusy` 进来。
 * 那是「网络繁忙请稍后重试」，在这里是假消息——请求明明通了。识别出来当没有原因处理。
 */
function isPlaceholderReason(message: string) {
  const networkBusy = directTrans('common', 'networkBusy').trim()
  return !!networkBusy && message === networkBusy
}

export function readApiFailure(response: ConfigApiResponseLike | null | undefined): ConfigApiFailure {
  if (!response) {
    return { code: null, reason: '', details: [] }
  }

  const rawReason = typeof response.message === 'string' ? response.message.trim() : ''

  return {
    code: response.code,
    reason: isPlaceholderReason(rawReason) ? '' : rawReason,
    details: readFailureDetails(response.data),
  }
}

/** 抛出来的异常（fetch 挂了、JSON 解析炸了之类），也按同一个结构走 */
export function readThrownFailure(error: unknown): ConfigApiFailure {
  const reason = error instanceof Error ? error.message.trim() : String(error).trim()
  return { code: null, reason, details: [] }
}

type FailureTranslator = (key: string, options?: Record<string, unknown>) => string

/**
 * 一次最多摊开几条细项。
 * 以前是 4 条，现在放宽到 8：受保护键被拒时这几条就是「到底哪个键」，
 * 截断等于把最该看的信息吞了。超出的部分明说还有几条，不装作没有。
 */
const failureDetailLimit = 8

/**
 * 拼出给用户看的那句话。
 * 顺序固定：原因 →（错误码 X）→ 细项。缺哪段就跳过哪段，**绝不补一句含糊话**。
 */
export function formatConfigFailure(failure: ConfigApiFailure, t: FailureTranslator): string {
  const segments: string[] = []

  if (failure.reason)
    segments.push(failure.reason)
  else if (failure.code === null)
    segments.push(t('errors.noResponse'))
  else
    segments.push(t('errors.serverNoReason'))

  if (failure.code !== null && failure.code !== undefined)
    segments.push(t('errors.codeSuffix', { code: String(failure.code) }))

  if (failure.details.length > 0) {
    segments.push(failure.details.slice(0, failureDetailLimit).join(' / '))
    if (failure.details.length > failureDetailLimit)
      segments.push(t('errors.moreDetails', { count: failure.details.length - failureDetailLimit }))
  }

  return segments.join(' ')
}
