import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createZodDto, ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { ConfigEditorConfig } from './config-editor.config'
import { ConfigEditorService } from './config-editor.service'
import { ConfigFileFormat } from './config-editor.vo'
import { onConfigOverrideSaved } from './config-override.events'

// 受保护的 auth / port 和可覆盖的 agent / notify 各来一个，notify 整段靠 zod 默认值填出来
const configSchema = z.object({
  port: z.number().int().default(3000),
  auth: z.object({
    secret: z.string(),
  }),
  agent: z.object({
    baseUrl: z.string(),
    apiKey: z.string(),
    models: z.array(z.string()).default(['upstream-a', 'upstream-b']),
  }),
  notify: z.object({
    enabled: z.boolean().default(false),
    group: z.string().default('AiToEarn'),
  }).default({ enabled: false, group: 'AiToEarn' }),
})

const baseYaml = `port: 3002
auth:
  secret: from-env
agent:
  baseUrl: https://base.example.com/v1/messages
  apiKey: base-key
`

function createConfig(filePath: string) {
  return {
    meta: {
      configPath: filePath,
    },
  }
}

describe('configEditorService', () => {
  let workspace: string
  let basePath: string
  let overridePath: string
  let service: ConfigEditorService

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'config-editor-'))
    basePath = join(workspace, 'config.yaml')
    overridePath = join(workspace, 'config.override.yaml')
    await writeFile(basePath, baseYaml, 'utf-8')
    service = new ConfigEditorService(new ConfigEditorConfig({
      schema: configSchema,
      config: createConfig(basePath),
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  describe('getConfig', () => {
    it('覆盖文件不存在时读到的就是基础配置，行为和没有覆盖层一样', async () => {
      const result = await service.getConfig()

      expect(result.format).toBe(ConfigFileFormat.Yaml)
      expect(result.config).toMatchObject({
        port: 3002,
        auth: { secret: 'from-env' },
        agent: {
          baseUrl: 'https://base.example.com/v1/messages',
          apiKey: 'base-key',
          models: ['upstream-a', 'upstream-b'],
        },
      })
      expect(result.overriddenPaths).toEqual([])
      expect(result.protectedPaths).toEqual(['port', 'auth'])
    })

    it('深合并覆盖层：对象递归合并，数组整体替换', async () => {
      await writeFile(overridePath, 'agent:\n  baseUrl: https://override.example.com/v1/messages\n  models:\n    - only-one\n', 'utf-8')

      const result = await service.getConfig()

      expect(result.config['agent']).toEqual({
        baseUrl: 'https://override.example.com/v1/messages',
        apiKey: 'base-key',
        models: ['only-one'],
      })
      expect(result.overriddenPaths).toEqual(['agent.baseUrl', 'agent.models'])
    })

    it('覆盖文件格式坏了就报覆盖层读取失败', async () => {
      await writeFile(overridePath, 'agent:\n  baseUrl: "没有收尾的引号\n', 'utf-8')

      await expect(service.getConfig()).rejects.toMatchObject({
        code: ResponseCode.ConfigOverrideReadFailed,
      })
    })

    it('覆盖文件是空文件时当作没有覆盖层', async () => {
      await writeFile(overridePath, '', 'utf-8')

      const result = await service.getConfig()

      expect(result.overriddenPaths).toEqual([])
      expect(result.config['agent']).toMatchObject({ baseUrl: 'https://base.example.com/v1/messages' })
    })
  })

  describe('saveConfig', () => {
    it('只把与基础配置不同的部分写进覆盖文件，基础配置一个字节都不碰', async () => {
      const { config } = await service.getConfig()

      await service.saveConfig({
        ...config,
        agent: {
          ...config['agent'] as Record<string, unknown>,
          baseUrl: 'https://override.example.com/v1/messages',
        },
      })

      expect(parseYaml(await readFile(overridePath, 'utf-8'))).toEqual({
        agent: {
          baseUrl: 'https://override.example.com/v1/messages',
        },
      })
      await expect(readFile(basePath, 'utf-8')).resolves.toBe(baseYaml)
    })

    it('没被动过的字段（包括 zod 默认值填出来的）不会被冻结成覆盖层里的同值副本', async () => {
      const { config } = await service.getConfig()

      await service.saveConfig(config)

      const written = parseYaml(await readFile(overridePath, 'utf-8'))
      expect(written).toEqual({})
      // notify 整段是默认值填出来的，models 也是，都不能进覆盖层
      expect(JSON.stringify(written)).not.toContain('notify')
      expect(JSON.stringify(written)).not.toContain('upstream-a')
    })

    it('保存之后再读，合并结果就是提交的值', async () => {
      const { config } = await service.getConfig()
      await service.saveConfig({
        ...config,
        notify: { enabled: true, group: 'Runtime' },
      })

      const result = await service.getConfig()

      expect(result.config['notify']).toEqual({ enabled: true, group: 'Runtime' })
      expect(result.overriddenPaths).toEqual(['notify.enabled', 'notify.group'])
    })

    it('改回和基础配置一样的值，覆盖层会被清空', async () => {
      const { config } = await service.getConfig()
      await service.saveConfig({
        ...config,
        agent: { ...config['agent'] as Record<string, unknown>, apiKey: 'runtime-key' },
      })
      expect(parseYaml(await readFile(overridePath, 'utf-8'))).toEqual({ agent: { apiKey: 'runtime-key' } })

      await service.saveConfig(config)

      expect(parseYaml(await readFile(overridePath, 'utf-8'))).toEqual({})
    })

    it('动到受保护的顶层键就拒绝，并逐个列出违规的键路径', async () => {
      const { config } = await service.getConfig()

      await expect(service.saveConfig({
        ...config,
        port: 3999,
        auth: { secret: 'from-web' },
      }))
        .rejects
        .toMatchObject({
          code: ResponseCode.ConfigOverrideProtectedKey,
        })

      const error = await service.saveConfig({
        ...config,
        port: 3999,
        auth: { secret: 'from-web' },
      }).catch((e: unknown) => e as { getResponse: () => { data: { paths: string[] } } })

      expect(error.getResponse().data.paths).toEqual(['port', 'auth.secret'])
      await expect(readFile(overridePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('校验失败时不写覆盖文件', async () => {
      const { config } = await service.getConfig()

      await expect(service.saveConfig({
        ...config,
        agent: { ...config['agent'] as Record<string, unknown>, baseUrl: 123 },
      }))
        .rejects
        .toMatchObject({
          code: ResponseCode.ConfigEditorValidationFailed,
        })
      await expect(readFile(overridePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('保存后广播变了的顶层键，给需要热生效的模块用', async () => {
      const listener = vi.fn()
      const unsubscribe = onConfigOverrideSaved(listener)

      try {
        const { config } = await service.getConfig()
        await service.saveConfig({
          ...config,
          agent: { ...config['agent'] as Record<string, unknown>, apiKey: 'runtime-key' },
        })
      }
      finally {
        unsubscribe()
      }

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0]?.[0]).toMatchObject({
        changedKeys: ['agent'],
        config: { agent: { apiKey: 'runtime-key' } },
      })
    })

    it('什么都没改就不广播', async () => {
      const listener = vi.fn()
      const unsubscribe = onConfigOverrideSaved(listener)

      try {
        const { config } = await service.getConfig()
        await service.saveConfig(config)
      }
      finally {
        unsubscribe()
      }

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('validateConfig', () => {
    it('受保护键的检查在校验阶段就拦住', async () => {
      const { config } = await service.getConfig()

      await expect(service.validateConfig({
        ...config,
        auth: { secret: 'from-web' },
      }))
        .rejects
        .toMatchObject({
          code: ResponseCode.ConfigOverrideProtectedKey,
        })
    })

    it('只动可覆盖的键就通过，并且不落任何文件', async () => {
      const { config } = await service.getConfig()

      await expect(service.validateConfig({
        ...config,
        agent: { ...config['agent'] as Record<string, unknown>, apiKey: 'runtime-key' },
      })).resolves.toBeUndefined()
      await expect(readFile(overridePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('json 配置', () => {
    it('json 基础配置对应 config.override.json，覆盖层也用 json 写', async () => {
      const jsonBasePath = join(workspace, 'config.json')
      const ConfigDto = createZodDto(configSchema)
      await writeFile(jsonBasePath, JSON.stringify({
        port: 3002,
        auth: { secret: 'from-env' },
        agent: { baseUrl: 'https://base.example.com/v1/messages', apiKey: 'base-key' },
      }), 'utf-8')

      const jsonService = new ConfigEditorService(new ConfigEditorConfig({
        schema: ConfigDto,
        config: createConfig(jsonBasePath),
      }))
      const { config } = await jsonService.getConfig()
      await jsonService.saveConfig({
        ...config,
        agent: { ...config['agent'] as Record<string, unknown>, apiKey: 'runtime-key' },
      })

      await expect(readFile(join(workspace, 'config.override.json'), 'utf-8'))
        .resolves
        .toBe('{\n  "agent": {\n    "apiKey": "runtime-key"\n  }\n}\n')
    })
  })

  it('拒绝不支持的配置文件扩展名', async () => {
    const txtService = new ConfigEditorService(new ConfigEditorConfig({
      schema: configSchema,
      config: createConfig(join(workspace, 'config.txt')),
    }))

    await expect(txtService.getConfig())
      .rejects
      .toMatchObject({
        code: ResponseCode.ConfigEditorUnsupportedFormat,
      })
  })
})
