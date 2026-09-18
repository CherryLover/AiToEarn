import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Options } from '@anthropic-ai/claude-agent-sdk'
import { Test } from '@nestjs/testing'
import { AppException, ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeService } from './agent-runtime.service'
import { ProjectWorkspaceService } from './project-workspace.service'

const { projectsConfig, queryMock, autoStubModule } = vi.hoisted(() => ({
  projectsConfig: { root: '' },
  queryMock: vi.fn(),
  /**
   * 这些包（mongodb / assets）在测试环境下没法真加载：schema 上的 @Prop 拿不到类型元数据。
   * 但这里只把它们当 DI token 和枚举用，缺什么补什么会没完没了，
   * 所以整包桩掉，没显式给出的导出一律返回一个空类。
   */
  autoStubModule: (known: Record<string, unknown>) => {
    // 这几个键是模块互操作用的，不能给桩，否则 await import 会把 then 当 thenable 调用
    const interopKeys = new Set(['then', 'default', '__esModule', 'constructor', 'prototype'])
    const exports: Record<string, unknown> = { ...known }

    return new Proxy(exports, {
      get(target, prop) {
        if (typeof prop === 'symbol' || interopKeys.has(prop))
          return Reflect.get(target, prop)
        if (!(prop in target))
          target[prop] = class Stub {}
        return target[prop]
      },
      has(target, prop) {
        if (typeof prop === 'symbol' || interopKeys.has(prop))
          return Reflect.has(target, prop)
        return true
      },
    })
  },
}))

// 真 config 要求命令行传 -c，测试里跑不起来，照 agent.dto.spec.ts 的写法整个桩掉
vi.mock('../../../config', async () => {
  const { z } = await import('zod')
  const anySchema = z.object({}).passthrough()

  return {
    config: {
      projects: projectsConfig,
      agent: {
        models: ['claude-opus-4-6'],
        defaultModel: 'claude-opus-4-6',
        backgroundModel: 'claude-haiku-4-5-20251001',
        thinkModel: 'claude-opus-4-6',
        taskTimeoutMs: 3600000,
        baseUrl: 'http://127.0.0.1:3456',
        apiKey: 'test',
      },
      serverClient: { baseUrl: 'http://127.0.0.1:3000' },
      ai: { relay: undefined },
    },
    aiModelsConfigSchema: anySchema,
    aiConfigSchema: anySchema,
    agentConfigSchema: anySchema,
    projectsConfigSchema: anySchema,
    appConfigSchema: anySchema,
    AppConfig: class AppConfig {},
  }
})

// 照 apps/aitoearn-server/src/core/projects/projects.service.spec.ts 的写法把 mongodb 层换成桩，
// 否则 schema 上的 @Prop 装饰器在测试环境下拿不到类型元数据，整个文件都导入不进来
vi.mock('@yikart/mongodb', () => autoStubModule({
  AiLogChannel: { ClaudeAgent: 'claudeAgent' },
  AiLogRepository: class AiLogRepository {},
  AiLogStatus: { Success: 'success', Failed: 'failed' },
  AiLogType: { Agent: 'agent' },
  AssetType: { Image: 'image', Video: 'video', Audio: 'audio', File: 'file' },
  ContentGenerationTask: class ContentGenerationTask {},
  ContentGenerationTaskRepository: class ContentGenerationTaskRepository {},
  ContentGenerationTaskStatus: {
    Running: 'running',
    Completed: 'completed',
    Error: 'error',
    Aborted: 'aborted',
    RequiresAction: 'requiresAction',
  },
  Transactional: () => () => undefined,
}))

// assets 层同理：它自己也要加载 mongodb 的 schema，只当 DI token 用，桩掉即可
vi.mock('@yikart/assets', () => autoStubModule({
  ASSETS_CONFIG: Symbol('ASSETS_CONFIG'),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()
  return {
    ...actual,
    query: queryMock,
  }
})

/** 阶段 1 之前就有的九个工具，不带 projectName 的任务必须一个不多一个不少 */
const BASE_TOOLS = [
  'Task',
  'TaskOutput',
  'Read',
  'WebFetch',
  'TodoWrite',
  'TaskStop',
  'Skill',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
]

describe('agentRuntimeService · 项目工作区', () => {
  let tmpRoot: string
  let root: string
  let outside: string
  let service: AgentRuntimeService
  let createdTaskDirs: string[]

  async function createService() {
    const moduleRef = await Test.createTestingModule({
      providers: [AgentRuntimeService, ProjectWorkspaceService],
    })
      .useMocker(() => ({}))
      .compile()

    return moduleRef.get(AgentRuntimeService)
  }

  function runQuery(options: Record<string, unknown>): Options {
    if (typeof options.taskId === 'string' && !options.projectName) {
      createdTaskDirs.push(join(process.cwd(), '.claude-session', 'tasks', options.taskId))
    }

    service.claudeQuery(
      [{ type: 'text', text: 'system' }],
      [{ type: 'text', text: 'hello' }],
      new AbortController(),
      options,
    )

    return queryMock.mock.calls.at(-1)![0].options as Options
  }

  beforeEach(async () => {
    queryMock.mockReset()
    queryMock.mockImplementation(() => (async function* () {})())

    createdTaskDirs = []
    tmpRoot = mkdtempSync(join(tmpdir(), 'aitoearn-runtime-'))
    root = join(tmpRoot, 'projects')
    outside = join(tmpRoot, 'outside')
    mkdirSync(join(root, 'demo', 'background', 'product'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.txt'), 'top secret')
    projectsConfig.root = root

    service = await createService()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    // claudeQuery 会真建出 .claude-session/tasks/<taskId>，测完顺手清掉，别把仓库弄脏
    for (const dir of createdTaskDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('不带 projectName（现有视频生成链路）', () => {
    it('工作目录还是 .claude-session 下的任务目录', () => {
      const options = runQuery({ taskId: 'task-1' })

      expect(options.cwd).toBe(join(process.cwd(), '.claude-session', 'tasks', 'task-1'))
      expect(existsSync(options.cwd!)).toBe(true)
    })

    it('工具白名单一个都不多', () => {
      const options = runQuery({ taskId: 'task-2' })

      expect(options.tools).toEqual(BASE_TOOLS)
      expect(options.tools).not.toContain('Bash')
      expect(options.tools).not.toContain('Write')
    })

    it('canUseTool 照旧全部放行，不加路径限制', async () => {
      const options = runQuery({ taskId: 'task-3' })
      const decision = await callCanUseTool(options, 'Read', { file_path: '/etc/passwd' })

      expect(decision).toEqual({ behavior: 'allow', updatedInput: { file_path: '/etc/passwd' } })
    })
  })

  describe('带 projectName', () => {
    it('工作目录换成项目物料目录', () => {
      const options = runQuery({ taskId: 'task-4', projectName: 'demo' })

      expect(options.cwd).toBe(join(root, 'demo'))
    })

    it('不给项目任务另建 .claude-session 任务目录', () => {
      runQuery({ taskId: 'task-5', projectName: 'demo' })

      expect(existsSync(join(process.cwd(), '.claude-session', 'tasks', 'task-5'))).toBe(false)
    })

    it('额外放开 Glob / Grep / Write / Edit，但不开 Bash', () => {
      const options = runQuery({ taskId: 'task-6', projectName: 'demo' })

      expect(options.tools).toEqual([...BASE_TOOLS, 'Glob', 'Grep', 'Write', 'Edit'])
      expect(options.tools).not.toContain('Bash')
    })

    it('项目目录不存在时直接报错，不自己建', () => {
      expect(() => runQuery({ taskId: 'task-7', projectName: 'nosuch' }))
        .toThrow(expect.objectContaining({ code: ResponseCode.ProjectNotFound }))
      expect(existsSync(join(root, 'nosuch'))).toBe(false)
    })

    it.each([
      ['Demo', ResponseCode.ProjectNameInvalid],
      ['de--mo', ResponseCode.ProjectNameInvalid],
      ['node_modules', ResponseCode.ProjectNameReserved],
      ['_archived_demo_20260918120000', ResponseCode.ProjectNameReserved],
    ])('拒绝调用方传来的非法项目名 %s', (projectName, code) => {
      try {
        runQuery({ taskId: 'task-8', projectName })
      }
      catch (error) {
        expect(error).toBeInstanceOf(AppException)
        expect((error as AppException).code).toBe(code)
        return
      }

      throw new Error('期望抛出异常，但没有抛出')
    })

    it('canUseTool 放行项目内的路径', async () => {
      const options = runQuery({ taskId: 'task-9', projectName: 'demo' })
      const input = { file_path: 'background/product/intro.md' }

      expect(await callCanUseTool(options, 'Read', input)).toEqual({ behavior: 'allow', updatedInput: input })
    })

    it('canUseTool 拒绝越界路径，并说明是越界不是文件不存在', async () => {
      const options = runQuery({ taskId: 'task-10', projectName: 'demo' })
      const decision = await callCanUseTool(options, 'Read', { file_path: '../outside/secret.txt' })

      expect(decision.behavior).toBe('deny')
      expect('message' in decision ? decision.message : '').toContain('outside the project workspace')
      expect('message' in decision ? decision.message : '').toContain('NOT a "file not found"')
    })

    it('canUseTool 拒绝软链逃逸的写入', async () => {
      symlinkSync(join(outside, 'not-yet.md'), join(root, 'demo', 'drafts.md'), 'file')
      const options = runQuery({ taskId: 'task-11', projectName: 'demo' })
      const decision = await callCanUseTool(options, 'Write', { file_path: 'drafts.md', content: 'x' })

      expect(decision.behavior).toBe('deny')
    })

    it('canUseTool 不拦非路径类工具', async () => {
      const options = runQuery({ taskId: 'task-12', projectName: 'demo' })
      const input = { url: 'https://example.com' }

      expect(await callCanUseTool(options, 'WebFetch', input)).toEqual({ behavior: 'allow', updatedInput: input })
    })
  })
})

async function callCanUseTool(options: Options, toolName: string, input: Record<string, unknown>) {
  return options.canUseTool!(toolName, input, {
    signal: new AbortController().signal,
    toolUseID: 'tool-use-1',
  })
}
