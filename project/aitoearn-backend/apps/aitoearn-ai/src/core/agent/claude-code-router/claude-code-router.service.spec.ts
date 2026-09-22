import { describe, expect, it, vi } from 'vitest'
import { CLAUDE_CODE_ROUTER_PROVIDER_NAME } from '../agent.constants'
import { ClaudeCodeRouterService } from './claude-code-router.service'

interface TestableClaudeCodeRouterService {
  generateConfigFile: (routerConfig: unknown) => void
  restartChildProcess: () => void
  buildConfigFile: (routerConfig: unknown) => {
    Providers?: Array<{
      name: string
      api_base_url: string
      api_key: string
      models: string[]
      transformer?: unknown
    }>
    Router?: {
      default: string
      background?: string
      think?: string
    }
  }
}

describe('claudeCodeRouterService', () => {
  it('上游说 Anthropic 协议时透传：transformer 就是配置里那一串', () => {
    const service = new ClaudeCodeRouterService() as unknown as TestableClaudeCodeRouterService
    const routerConfig = service.buildConfigFile({
      baseUrl: 'https://agent.example.com/v1/messages',
      apiKey: 'agent-key',
      models: ['deepseek-anthropic-chat', 'deepseek-anthropic-lite'],
      defaultModel: 'deepseek-anthropic-chat',
      backgroundModel: 'deepseek-anthropic-lite',
      thinkModel: 'deepseek-anthropic-chat',
      transformers: ['Anthropic'],
    })

    expect(routerConfig.Providers?.[0]).toEqual({
      name: CLAUDE_CODE_ROUTER_PROVIDER_NAME,
      api_base_url: 'https://agent.example.com/v1/messages',
      api_key: 'agent-key',
      models: ['deepseek-anthropic-chat', 'deepseek-anthropic-lite'],
      transformer: {
        use: ['Anthropic'],
      },
    })
    expect(routerConfig.Router).toEqual({
      default: `${CLAUDE_CODE_ROUTER_PROVIDER_NAME},deepseek-anthropic-chat`,
      background: `${CLAUDE_CODE_ROUTER_PROVIDER_NAME},deepseek-anthropic-lite`,
      think: `${CLAUDE_CODE_ROUTER_PROVIDER_NAME},deepseek-anthropic-chat`,
    })
  })

  // 上游是 OpenAI 协议的中转站：给一个 `use: []` 和整个字段不给是两回事，
  // 只有不给这个字段，router 才会走缺省的 Anthropic↔OpenAI 互转
  it('transformers 为空时整个 transformer 字段都不写进去', () => {
    const service = new ClaudeCodeRouterService() as unknown as TestableClaudeCodeRouterService
    const routerConfig = service.buildConfigFile({
      baseUrl: 'https://relay.example.com/v1/chat/completions',
      apiKey: 'relay-key',
      models: ['gpt-x'],
      defaultModel: 'gpt-x',
      backgroundModel: 'gpt-x',
      thinkModel: 'gpt-x',
      transformers: [],
    })

    expect(routerConfig.Providers?.[0]).not.toHaveProperty('transformer')
    expect(routerConfig.Providers?.[0]?.api_base_url).toBe('https://relay.example.com/v1/chat/completions')
  })

  it('也能用 router 支持的其它 transformer', () => {
    const service = new ClaudeCodeRouterService() as unknown as TestableClaudeCodeRouterService
    const routerConfig = service.buildConfigFile({
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'or-key',
      models: ['some/model'],
      defaultModel: 'some/model',
      backgroundModel: 'some/model',
      thinkModel: 'some/model',
      transformers: ['openrouter'],
    })

    expect(routerConfig.Providers?.[0]?.transformer).toEqual({ use: ['openrouter'] })
  })
})

describe('claudeCodeRouterService 热生效', () => {
  it('重新生成 router 配置并重启子进程，主进程不动', () => {
    const service = new ClaudeCodeRouterService()
    const testable = service as unknown as TestableClaudeCodeRouterService
    const generateConfigFile = vi.spyOn(testable, 'generateConfigFile').mockImplementation(() => {})
    const restartChildProcess = vi.spyOn(testable, 'restartChildProcess').mockImplementation(() => {})

    const agentConfig = {
      baseUrl: 'https://override.example.com/v1/messages',
      apiKey: 'runtime-key',
      models: ['upstream-a'],
      defaultModel: 'upstream-a',
      backgroundModel: 'upstream-a',
      thinkModel: 'upstream-a',
      transformers: [],
      taskTimeoutMs: 1000,
    }
    service.reloadAgentConfig(agentConfig as unknown as Parameters<typeof service.reloadAgentConfig>[0])

    expect(generateConfigFile).toHaveBeenCalledWith(agentConfig)
    expect(restartChildProcess).toHaveBeenCalledTimes(1)
  })
})
