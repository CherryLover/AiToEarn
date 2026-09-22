import { Injectable, Logger } from '@nestjs/common'
import { ResponseCode } from '@yikart/common'
import axios from 'axios'
import { config } from '../../config'
import { CLAUDE_CODE_ROUTER_API_KEY, CLAUDE_CODE_ROUTER_BASE_URL } from '../agent/agent.constants'
import { sanitizeDetail } from './readiness.sanitize'

/** 探一次上游最多等这么久（contract-runtime-config 4.1 写死 5 秒） */
export const AGENT_UPSTREAM_PROBE_TIMEOUT_MS = 5000

/** 探测请求的 `max_tokens`：只要上游认了这次请求就够，不需要它真生成内容 */
const PROBE_MAX_TOKENS = 1

const ANTHROPIC_VERSION = '2023-06-01'

export type ReadinessStatus = 'ok' | 'missing' | 'error'

export interface InternalReadinessItem {
  key: string
  status: ReadinessStatus
  required: boolean
  configPath: string | null
  detail: string | null
}

/**
 * ai 侧的就绪检查。
 *
 * 只管两件 server 那边判不了的事：
 * - `agentUpstream`：`agent.*` 的上游到底通不通。**真发一个最小的 messages 请求**，
 *   不是看配置非空——线上那次事故正是「配置非空但从来没被覆盖过」，占位值一直躺在那儿。
 *   请求打的是本机的 claude-code-router，不是直连 `agent.baseUrl`：真正跑提炼方向的
 *   `claude` 进程就是这么走的，中间那层 transformer 配错了（上游是 OpenAI 协议却留着
 *   Anthropic 透传）也是一种「用不了」。直连上游探不出这一类问题，等于报了个假的绿灯；
 * - `aiChatModels`：`ai.models.chat` 和 `ai.openai.apiKey` 都只存在于 ai 的配置里，
 *   server 进程里根本读不到，所以这一项也只能落在这边判。
 *
 * 两条硬规矩：
 * 1. **一个方法都不抛错**，探不通就回 `error` + `detail`，就绪检查绝不影响主流程；
 * 2. **detail 和日志里绝不出现 Key**，统一过 `sanitizeDetail`。
 */
@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name)

  async listItems(): Promise<InternalReadinessItem[]> {
    return Promise.all([
      this.probeSafely('agentUpstream', 'agent.baseUrl', true, () => this.probeAgentUpstream()),
      this.probeSafely('aiChatModels', 'ai.models.chat', true, () => this.probeAiChatModels()),
    ])
  }

  /** 探测本身炸了（我们自己的 bug、配置读不到）也要出一条结果，而不是把整个接口带崩 */
  private async probeSafely(
    key: string,
    configPath: string,
    required: boolean,
    probe: () => Promise<InternalReadinessItem>,
  ): Promise<InternalReadinessItem> {
    try {
      return await probe()
    }
    catch (error) {
      this.logger.warn(
        error as Error,
        `就绪检查项 ${key} 探测时自身出错 code=${ResponseCode.SystemReadinessProbeFailed}`,
      )
      return {
        key,
        status: 'error',
        required,
        configPath,
        detail: `检查这一项的时候自己出错了：${sanitizeDetail(error, this.secrets())}`,
      }
    }
  }

  /** 配置里的明文 Key，清洗 detail 时整串抹掉 */
  private secrets(): string[] {
    return [
      config.agent?.apiKey ?? '',
      config.ai?.openai?.apiKey ?? '',
      config.ai?.anthropic?.apiKey ?? '',
    ].filter(Boolean)
  }

  private async probeAgentUpstream(): Promise<InternalReadinessItem> {
    const agent = config.agent
    const baseUrl = agent?.baseUrl?.trim() ?? ''
    const apiKey = agent?.apiKey?.trim() ?? ''

    if (!baseUrl || !apiKey) {
      return {
        key: 'agentUpstream',
        status: 'missing',
        required: true,
        configPath: !baseUrl ? 'agent.baseUrl' : 'agent.apiKey',
        detail: !baseUrl
          ? 'agent.baseUrl 还没填，AI 提炼方向这类要跑 Agent 的功能都用不了'
          : 'agent.apiKey 还没填，AI 提炼方向这类要跑 Agent 的功能都用不了',
      }
    }

    const startedAt = Date.now()
    try {
      const response = await axios.post(
        `${CLAUDE_CODE_ROUTER_BASE_URL}/v1/messages`,
        {
          model: agent.defaultModel,
          max_tokens: PROBE_MAX_TOKENS,
          messages: [{ role: 'user', content: 'ping' }],
        },
        {
          timeout: AGENT_UPSTREAM_PROBE_TIMEOUT_MS,
          // 非 2xx 不抛错：我们要拿状态码和返回体当 detail，不是当异常
          validateStatus: () => true,
          // router 在本机回环上，走代理会直接连不上
          proxy: false,
          headers: {
            'content-type': 'application/json',
            'anthropic-version': ANTHROPIC_VERSION,
            // 这是 router 自己的口令，不是上游的 Key；上游的 Key 由 router 按配置加
            'x-api-key': CLAUDE_CODE_ROUTER_API_KEY,
          },
        },
      )

      if (response.status >= 200 && response.status < 300) {
        return {
          key: 'agentUpstream',
          status: 'ok',
          required: true,
          configPath: 'agent.baseUrl',
          detail: null,
        }
      }

      this.logger.warn(
        `agent 上游探测被拒 status=${response.status} code=${ResponseCode.SystemReadinessUpstreamUnreachable}`,
      )
      return {
        key: 'agentUpstream',
        status: 'error',
        required: true,
        configPath: 'agent.baseUrl',
        detail: `上游返回 HTTP ${response.status}：${sanitizeDetail(response.data, this.secrets())}`
          + `（请求经本机 claude-code-router 转发，对不上多半是 agent.baseUrl、agent.apiKey 或 agent.transformers 配错了）`,
      }
    }
    catch (error) {
      const detail = this.describeRequestFailure(error, Date.now() - startedAt)
      this.logger.warn(
        error as Error,
        `agent 上游探测失败 code=${ResponseCode.SystemReadinessUpstreamUnreachable}`,
      )
      return {
        key: 'agentUpstream',
        status: 'error',
        required: true,
        configPath: 'agent.baseUrl',
        detail,
      }
    }
  }

  private describeRequestFailure(error: unknown, elapsedMs: number): string {
    const code = (error as { code?: string } | null)?.code
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return `探测超时：${AGENT_UPSTREAM_PROBE_TIMEOUT_MS / 1000} 秒内上游没有响应（已等 ${elapsedMs} 毫秒）`
    }
    if (code === 'ECONNREFUSED') {
      return '本机的 claude-code-router 没在监听，ai 服务可能刚起来还没把它拉起来，稍后再试一次'
    }
    return `连不上上游：${sanitizeDetail(error, this.secrets())}`
  }

  private async probeAiChatModels(): Promise<InternalReadinessItem> {
    const chatModels = config.ai?.models?.chat ?? []
    const openaiApiKey = config.ai?.openai?.apiKey?.trim() ?? ''

    if (chatModels.length === 0) {
      return {
        key: 'aiChatModels',
        status: 'missing',
        required: true,
        configPath: 'ai.models.chat',
        detail: '一个对话模型都没配，网页上的模型列表会是空的',
      }
    }

    if (!openaiApiKey) {
      return {
        key: 'aiChatModels',
        status: 'missing',
        required: true,
        configPath: 'ai.openai.apiKey',
        detail: '模型清单配了，但 ai.openai.apiKey 是空的，调用会直接被上游拒掉',
      }
    }

    return {
      key: 'aiChatModels',
      status: 'ok',
      required: true,
      configPath: 'ai.models.chat',
      detail: null,
    }
  }
}
