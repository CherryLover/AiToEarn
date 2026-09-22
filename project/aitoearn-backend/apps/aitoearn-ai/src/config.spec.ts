import { describe, expect, it } from 'vitest'
import { agentConfigSchema } from './config'

const baseAgentConfig = {
  baseUrl: 'https://agent.example.com/v1/messages',
  apiKey: 'agent-key',
  analysis: {
    apiKey: 'gemini-key',
  },
}

describe('agentConfigSchema', () => {
  it('applies the existing Claude model defaults', () => {
    const agentConfig = agentConfigSchema.parse(baseAgentConfig)

    expect(agentConfig.defaultModel).toBe('claude-opus-4-6')
    expect(agentConfig.backgroundModel).toBe('claude-haiku-4-5-20251001')
    expect(agentConfig.thinkModel).toBe('claude-opus-4-6')
    expect(agentConfig.models).toContain('claude-opus-4-6')
  })

  it('accepts an Anthropic-compatible third-party model set', () => {
    const agentConfig = agentConfigSchema.parse({
      ...baseAgentConfig,
      models: ['deepseek-anthropic-chat', 'deepseek-anthropic-lite'],
      defaultModel: 'deepseek-anthropic-chat',
      backgroundModel: 'deepseek-anthropic-lite',
      thinkModel: 'deepseek-anthropic-chat',
    })

    expect(agentConfig.models).toEqual(['deepseek-anthropic-chat', 'deepseek-anthropic-lite'])
    expect(agentConfig.defaultModel).toBe('deepseek-anthropic-chat')
  })

  it('默认是 Anthropic 透传：上游本身就说 Anthropic 协议时不用配', () => {
    expect(agentConfigSchema.parse(baseAgentConfig).transformers).toEqual(['Anthropic'])
  })

  // 上游是 OpenAI 协议的中转站时填空数组，router 的缺省行为就是两边互转
  it('接受空的 transformers：交给 router 做 Anthropic 和 OpenAI 互转', () => {
    expect(agentConfigSchema.parse({ ...baseAgentConfig, transformers: [] }).transformers).toEqual([])
  })

  it('接受 router 支持的其它 transformer', () => {
    expect(agentConfigSchema.parse({ ...baseAgentConfig, transformers: ['openrouter'] }).transformers)
      .toEqual(['openrouter'])
  })

  it('rejects route models that are not configured', () => {
    expect(() => agentConfigSchema.parse({
      ...baseAgentConfig,
      models: ['deepseek-anthropic-chat'],
      defaultModel: 'missing-model',
      backgroundModel: 'deepseek-anthropic-chat',
      thinkModel: 'deepseek-anthropic-chat',
    })).toThrow(/defaultModel must be included in agent\.models/)
  })
})
