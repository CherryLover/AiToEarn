/**
 * 拉上游模型清单。盯的是三件事：
 * - 从 `agent.baseUrl` 推列模型地址时，两种协议的形状都能推对
 * - 拉不到一律不抛错，回空清单 + `detail`（界面据此退回手填）
 * - `detail` 里绝不出现 Key
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_MODELS_FETCH_TIMEOUT_MS,
  AgentModelsService,
  extractModelNames,
  resolveAgentModelsUrl,
} from './agent-models.service'

const { agentConfig, configFailure, getMock } = vi.hoisted(() => ({
  agentConfig: {
    baseUrl: 'https://way.example.com/v1/messages',
    apiKey: 'sk-agent-secret-value',
  },
  // 读配置这一步就炸掉的情况：用来验最外层那道兜底
  configFailure: { error: null as Error | null },
  getMock: vi.fn(),
}))

vi.mock('../../config', () => ({
  config: {
    get agent() {
      if (configFailure.error)
        throw configFailure.error
      return agentConfig
    },
  },
}))

vi.mock('axios', () => ({
  default: {
    get: getMock,
  },
}))

describe('resolveAgentModelsUrl', () => {
  it.each([
    // Anthropic 协议：地址填到 /v1/messages
    ['https://way.example.com/v1/messages', 'https://way.example.com/v1/models'],
    // OpenAI 协议：地址填到 /v1/chat/completions
    ['https://relay.example.com/v1/chat/completions', 'https://relay.example.com/v1/models'],
    // 只填到 /v1 也认
    ['https://relay.example.com/v1', 'https://relay.example.com/v1/models'],
    // 网关带一层前缀：认最后一个 v1，它后面的一律不要
    ['https://gw.example.com/openai/v1/chat/completions', 'https://gw.example.com/openai/v1/models'],
    // 尾斜杠、query、hash 都不该带进去
    ['https://relay.example.com/v1/messages/?foo=1#x', 'https://relay.example.com/v1/models'],
    // 压根没有 v1 这一层：在原路径后面接 models，而不是瞎猜
    ['https://relay.example.com/api', 'https://relay.example.com/api/models'],
  ])('%s → %s', (input, expected) => {
    expect(resolveAgentModelsUrl(input)).toBe(expected)
  })

  it.each([
    ['', '空地址'],
    ['   ', '只有空白'],
    ['way.example.com/v1', '没有协议头'],
    ['ftp://way.example.com/v1', '不是 http(s)'],
  ])('推不出来时回 null：%s（%s）', (input) => {
    expect(resolveAgentModelsUrl(input)).toBeNull()
  })
})

describe('extractModelNames', () => {
  it.each([
    ['OpenAI / Anthropic 的 data[].id', { data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }],
    ['裸数组', ['gpt-5', 'gpt-5-mini']],
    ['models[] 包一层', { models: [{ name: 'gpt-5' }, { name: 'gpt-5-mini' }] }],
  ])('%s 都挖得出来', (_, payload) => {
    expect(extractModelNames(payload)).toEqual(['gpt-5', 'gpt-5-mini'])
  })

  it('去重，并保持上游给的顺序', () => {
    expect(extractModelNames({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })).toEqual(['b', 'a'])
  })

  it('带逗号的模型名直接丢掉：agent.models 那一段渲染成配置时是逗号分隔的，存进去会被拆成两个', () => {
    expect(extractModelNames({ data: [{ id: 'good' }, { id: 'ba,d' }] })).toEqual(['good'])
  })

  it.each([
    ['形状对不上', { foo: 'bar' }],
    ['null', null],
    ['字符串', 'nope'],
  ])('%s 时回空数组，不抛错', (_, payload) => {
    expect(extractModelNames(payload)).toEqual([])
  })
})

describe('agentModelsService', () => {
  let service: AgentModelsService

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    getMock.mockReset()
    configFailure.error = null
    agentConfig.baseUrl = 'https://way.example.com/v1/messages'
    agentConfig.apiKey = 'sk-agent-secret-value'
    service = new AgentModelsService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('拉到了就回清单，请求打的是推出来的列模型地址、两种协议的认证头都带上', async () => {
    getMock.mockResolvedValue({ status: 200, data: { data: [{ id: 'gpt-5.6-luna' }] } })

    const result = await service.listModels()

    expect(result).toEqual({ models: ['gpt-5.6-luna'], detail: null })

    const [url, options] = getMock.mock.calls[0]
    expect(url).toBe('https://way.example.com/v1/models')
    expect(options.headers.authorization).toBe('Bearer sk-agent-secret-value')
    expect(options.headers['x-api-key']).toBe('sk-agent-secret-value')
    expect(options.timeout).toBe(AGENT_MODELS_FETCH_TIMEOUT_MS)
    expect(options.proxy).toBe(false)
  })

  it.each([
    ['地址还没填', { baseUrl: '' }, 'agent.baseUrl'],
    ['密钥还没填', { apiKey: '  ' }, 'agent.apiKey'],
  ])('%s 时说清楚缺哪一项，而且一次请求都不发', async (_, patch, expected) => {
    Object.assign(agentConfig, patch)

    const result = await service.listModels()

    expect(result.models).toEqual([])
    expect(result.detail).toContain(expected)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('上游拒掉时带上状态码，但不带 Key', async () => {
    agentConfig.apiKey = 'sk-super-secret-agent-key'
    getMock.mockResolvedValue({
      status: 401,
      data: { error: { message: 'Incorrect API key provided: sk-super-secret-agent-key' } },
    })

    const result = await service.listModels()

    expect(result.models).toEqual([])
    expect(result.detail).toContain('401')
    expect(result.detail).not.toContain('sk-super-secret-agent-key')
  })

  it('连不上时回原因，不抛异常', async () => {
    getMock.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))

    await expect(service.listModels()).resolves.toEqual({
      models: [],
      detail: expect.stringContaining('连不上上游'),
    })
  })

  it('上游认了请求但一个模型名都没报上来时，说的是这件事，而不是假装拉到了', async () => {
    getMock.mockResolvedValue({ status: 200, data: { data: [] } })

    const result = await service.listModels()

    expect(result.models).toEqual([])
    expect(result.detail).toContain('没报上来')
  })

  it('axios 同步抛出和 reject 一样处理，都算连不上上游', async () => {
    getMock.mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(service.listModels()).resolves.toEqual({
      models: [],
      detail: expect.stringContaining('连不上上游'),
    })
  })

  it('连读配置都炸了也出结果，不把整个接口带崩', async () => {
    configFailure.error = new Error('配置读不出来')

    await expect(service.listModels()).resolves.toEqual({ models: [], detail: '配置读不出来' })
    expect(getMock).not.toHaveBeenCalled()
  })
})
