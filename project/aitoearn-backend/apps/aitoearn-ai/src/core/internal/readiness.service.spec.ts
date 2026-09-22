/**
 * ai 侧就绪检查。盯住的是契约里那几条硬要求：
 * - `agentUpstream` 必须**真发一次请求**，不是看配置非空（占位值 `sk-placeholder` 正是非空的）
 * - 探不通一律不抛错，回 `error` + `detail`
 * - 超时 5 秒
 * - detail 里绝不出现 Key
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_UPSTREAM_PROBE_TIMEOUT_MS, ReadinessService } from './readiness.service'

const { agentConfig, aiConfig, postMock } = vi.hoisted(() => ({
  agentConfig: {
    baseUrl: 'https://upstream.example.com/v1/messages',
    apiKey: 'sk-placeholder',
    defaultModel: 'demo-model',
  },
  aiConfig: {
    models: { chat: [{ name: 'demo-model' }] },
    openai: { apiKey: 'sk-openai-secret-value' },
    anthropic: { apiKey: '' },
  },
  postMock: vi.fn(),
}))

vi.mock('../../config', () => ({
  config: {
    get agent() {
      return agentConfig
    },
    get ai() {
      return aiConfig
    },
  },
}))

vi.mock('axios', () => ({
  default: {
    post: postMock,
  },
}))

function findItem(items: { key: string }[], key: string) {
  const item = items.find(entry => entry.key === key)
  if (!item)
    throw new Error(`没有返回 ${key} 这一项`)
  return item
}

describe('readinessService', () => {
  let service: ReadinessService

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    postMock.mockReset()
    agentConfig.baseUrl = 'https://upstream.example.com/v1/messages'
    agentConfig.apiKey = 'sk-placeholder'
    agentConfig.defaultModel = 'demo-model'
    aiConfig.models = { chat: [{ name: 'demo-model' }] }
    aiConfig.openai = { apiKey: 'sk-openai-secret-value' }
    service = new ReadinessService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('agentUpstream', () => {
    it('上游回 2xx 就是 ok，而且真的发了一次 messages 请求', async () => {
      postMock.mockResolvedValue({ status: 200, data: { id: 'msg_1' } })

      const items = await service.listItems()
      const item = findItem(items, 'agentUpstream')

      expect(item.status).toBe('ok')
      expect(item.detail).toBeNull()
      expect(item.required).toBe(true)
      expect(item.configPath).toBe('agent.baseUrl')

      expect(postMock).toHaveBeenCalledTimes(1)
      const [url, body, options] = postMock.mock.calls[0]
      // 探的是本机 router，不是直连 agent.baseUrl：真正跑提炼方向的 claude 进程就走这条路，
      // 中间那层 transformer 配错了（上游说 OpenAI 协议却留着 Anthropic 透传）直连是探不出来的
      expect(url).toBe('http://127.0.0.1:3456/v1/messages')
      expect(options.headers['x-api-key']).toBe('ccr')
      expect(options.proxy).toBe(false)
      expect(body.model).toBe('demo-model')
      expect(body.messages).toHaveLength(1)
      expect(options.timeout).toBe(AGENT_UPSTREAM_PROBE_TIMEOUT_MS)
      expect(AGENT_UPSTREAM_PROBE_TIMEOUT_MS).toBe(5000)
    })

    it('baseUrl 或 apiKey 为空是 missing，而且一次请求都不发', async () => {
      agentConfig.baseUrl = ''

      const items = await service.listItems()
      const item = findItem(items, 'agentUpstream')

      expect(item.status).toBe('missing')
      expect(item.configPath).toBe('agent.baseUrl')
      expect(postMock).not.toHaveBeenCalled()
    })

    it('apiKey 为空时指到 agent.apiKey', async () => {
      agentConfig.apiKey = '   '

      const items = await service.listItems()
      const item = findItem(items, 'agentUpstream')

      expect(item.status).toBe('missing')
      expect(item.configPath).toBe('agent.apiKey')
    })

    it('上游拒掉（占位值的典型下场）是 error，detail 带状态码但不带 Key', async () => {
      postMock.mockResolvedValue({
        status: 401,
        data: { error: { message: 'Incorrect API key provided: sk-placeholder', type: 'invalid_request_error' } },
      })

      const items = await service.listItems()
      const item = findItem(items, 'agentUpstream')

      expect(item.status).toBe('error')
      expect(item.detail).toContain('401')
      expect(item.detail).not.toContain('sk-placeholder')
      // 报错要把人引到该改的三个字段上，尤其 transformers——协议选错是最难自己看出来的那种
      expect(item.detail).toContain('agent.transformers')
    })

    it('超时回 error，并说清楚等了多久', async () => {
      postMock.mockRejectedValue(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }))

      const items = await service.listItems()
      const item = findItem(items, 'agentUpstream')

      expect(item.status).toBe('error')
      expect(item.detail).toContain('探测超时')
      expect(item.detail).toContain('5 秒')
    })

    it('router 还没起来回 error，并说清楚是本机那一层，不抛异常', async () => {
      postMock.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3456'), { code: 'ECONNREFUSED' }))

      await expect(service.listItems()).resolves.toBeDefined()
      const item = findItem(await service.listItems(), 'agentUpstream')

      expect(item.status).toBe('error')
      expect(item.detail).toContain('claude-code-router 没在监听')
    })

    it('其它网络错误回 error，不抛异常', async () => {
      postMock.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))

      const item = findItem(await service.listItems(), 'agentUpstream')

      expect(item.status).toBe('error')
      expect(item.detail).toContain('连不上上游')
    })

    it('detail 里绝不出现配置里的任何一把 Key', async () => {
      agentConfig.apiKey = 'sk-super-secret-agent-key'
      postMock.mockRejectedValue(
        new Error('request failed with key sk-super-secret-agent-key and sk-openai-secret-value'),
      )

      const items = await service.listItems()
      const item = findItem(items, 'agentUpstream')

      expect(item.detail).not.toContain('sk-super-secret-agent-key')
      expect(item.detail).not.toContain('sk-openai-secret-value')
    })
  })

  describe('aiChatModels', () => {
    it('模型清单和 openai key 都有就是 ok', async () => {
      postMock.mockResolvedValue({ status: 200, data: {} })

      const item = findItem(await service.listItems(), 'aiChatModels')

      expect(item.status).toBe('ok')
      expect(item.detail).toBeNull()
      expect(item.configPath).toBe('ai.models.chat')
    })

    it('模型清单为空是 missing', async () => {
      postMock.mockResolvedValue({ status: 200, data: {} })
      aiConfig.models = { chat: [] }

      const item = findItem(await service.listItems(), 'aiChatModels')

      expect(item.status).toBe('missing')
      expect(item.configPath).toBe('ai.models.chat')
    })

    it('openai key 为空是 missing，并指到那个字段', async () => {
      postMock.mockResolvedValue({ status: 200, data: {} })
      aiConfig.openai = { apiKey: '' }

      const item = findItem(await service.listItems(), 'aiChatModels')

      expect(item.status).toBe('missing')
      expect(item.configPath).toBe('ai.openai.apiKey')
    })
  })

  it('探测自身炸了也出结果，不把整个接口带崩', async () => {
    postMock.mockImplementation(() => {
      throw new Error('boom')
    })

    const items = await service.listItems()

    expect(items).toHaveLength(2)
    expect(findItem(items, 'agentUpstream').status).toBe('error')
  })
})
