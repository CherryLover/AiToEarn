/**
 * 「上游都有哪些模型」——去上游真问一次。
 *
 * 起因：引导页上「默认模型」原来是个空输入框，要人照着服务商文档手抄模型名。
 * 抄错了不会当场报错，要等到点「让 AI 提炼方向」时才收一句上游的 404，
 * 而且那句 404 里写的还是**旧的**模型名（新值因为校验没过根本没存进去），
 * 人会以为自己填对了。把清单拉回来做成下拉，这一类问题整类消失。
 *
 * 两条硬规矩，跟就绪检查一致：
 * 1. **不抛错**。拉不到就回空清单 + `detail`，界面退回手填，不能因为拉不到清单就把人锁死；
 * 2. **detail 和日志里绝不出现 Key**，统一过 `sanitizeDetail`。
 */
import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { config } from '../../config'
import { sanitizeDetail } from './readiness.sanitize'

/** 拉清单最多等这么久。比探活那 5 秒松一点：这是人点开下拉时的一次交互，慢一点也能接受 */
export const AGENT_MODELS_FETCH_TIMEOUT_MS = 8000

const ANTHROPIC_VERSION = '2023-06-01'

/** 一次最多认这么多个模型名。上游若回了个几千条的清单，下拉框没有意义，也不该占着内存 */
const MAX_MODELS = 500

export interface AgentModelsResult {
  /** 上游报上来的模型名，去重后按原顺序。拉不到就是空数组 */
  models: string[]
  /** 拉不到时的原因，给人看的；拉到了就是 null。绝不含任何 Key */
  detail: string | null
}

/**
 * 从 `agent.baseUrl` 推出「列模型」的地址。
 *
 * Anthropic 和 OpenAI 两边的列模型接口都是 `GET <前缀>/v1/models`，差别只在
 * `baseUrl` 被配成了哪一层：Anthropic 协议填到 `/v1/messages`，
 * OpenAI 协议填到 `/v1/chat/completions`。所以先把这两个尾巴砍掉，
 * 砍不掉就退回「找最后一个 /v1」，再不行才在原路径后面接 `/models`。
 *
 * 推不出来时回 `null`，由调用方说「这个地址推不出列模型接口」，而不是瞎猜一个去打。
 */
export function resolveAgentModelsUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim()
  if (!trimmed)
    return null

  let url: URL
  try {
    url = new URL(trimmed)
  }
  catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return null

  const segments = url.pathname.split('/').filter(Boolean)

  // `/v1/messages` 或 `/v1/chat/completions` —— 把动作那几段砍掉
  if (segments.at(-1) === 'messages')
    segments.pop()
  else if (segments.at(-1) === 'completions' && segments.at(-2) === 'chat')
    segments.splice(-2)

  // 地址填成了别的形状（例如直接填到 `/v1` 或者带了一层网关前缀）：
  // 认最后一个 `v1`，它后面的东西一律不要
  const versionIndex = segments.lastIndexOf('v1')
  if (versionIndex >= 0)
    segments.splice(versionIndex + 1)

  segments.push('models')
  url.pathname = `/${segments.join('/')}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

/** 上游的返回体里把模型名挖出来。OpenAI 和 Anthropic 都是 `data[].id`，其余形状尽力而为 */
export function extractModelNames(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown })?.models)
        ? (payload as { models: unknown[] }).models
        : []

  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const name = typeof row === 'string'
      ? row
      : typeof (row as { id?: unknown })?.id === 'string'
        ? (row as { id: string }).id
        : typeof (row as { name?: unknown })?.name === 'string'
          ? (row as { name: string }).name
          : null

    // 模型名里带逗号的存不进 `agent.models`（那一段渲染成配置时是逗号分隔），直接丢掉
    if (!name || name.includes(',') || seen.has(name))
      continue

    seen.add(name)
    names.push(name)
    if (names.length >= MAX_MODELS)
      break
  }
  return names
}

@Injectable()
export class AgentModelsService {
  private readonly logger = new Logger(AgentModelsService.name)

  async listModels(): Promise<AgentModelsResult> {
    try {
      return await this.fetchModels()
    }
    catch (error) {
      // 我们自己的 bug 也不许把接口带崩：引导页拉不到清单就退回手填
      const detail = sanitizeDetail(error instanceof Error ? error.message : String(error))
      this.logger.warn(`拉上游模型清单失败：${detail}`)
      return { models: [], detail }
    }
  }

  private async fetchModels(): Promise<AgentModelsResult> {
    const { baseUrl, apiKey } = config.agent

    if (!baseUrl?.trim())
      return { models: [], detail: '还没填上游接口地址（agent.baseUrl）' }
    if (!apiKey?.trim())
      return { models: [], detail: '还没填上游密钥（agent.apiKey）' }

    const url = resolveAgentModelsUrl(baseUrl)
    if (!url)
      return { models: [], detail: `从 agent.baseUrl 推不出列模型接口，地址形状对不上：${sanitizeDetail(baseUrl)}` }

    let response
    try {
      response = await axios.get(url, {
        timeout: AGENT_MODELS_FETCH_TIMEOUT_MS,
        validateStatus: () => true,
        proxy: false,
        headers: {
          // 两种协议的认证头一起发：对方只认其中一个，另一个会被忽略。
          // 这里不去猜上游是哪一种——猜错的代价是一个看不懂的 401
          'authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      })
    }
    catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { models: [], detail: `连不上上游：${sanitizeDetail(raw)}` }
    }

    if (response.status < 200 || response.status >= 300) {
      const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
      return {
        models: [],
        detail: `上游返回 HTTP ${response.status}：${sanitizeDetail(body)}`,
      }
    }

    const models = extractModelNames(response.data)
    if (models.length === 0)
      return { models: [], detail: '上游认了这次请求，但没报上来任何模型名' }

    return { models, detail: null }
  }
}
