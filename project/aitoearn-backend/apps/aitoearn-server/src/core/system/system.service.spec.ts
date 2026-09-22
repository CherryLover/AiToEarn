/**
 * 就绪检查。盯住契约里那几条硬要求（contract-runtime-config 4.1）：
 * - 五项各自能出 ok / missing / error
 * - ai 服务连不上，整个接口照样返回，不抛错
 * - detail 里绝不出现 Key
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemService } from './system.service'

const { configMock } = vi.hoisted(() => ({
  configMock: {
    projects: { root: '/data/projects' },
    notify: { enabled: false, barkUrl: '', barkKey: '', group: 'AiToEarn' },
    assets: { provider: 's3', accessKeyId: 'AKIAREADINESSPROBE', secretAccessKey: 'super-secret-access-key' },
    aiClient: { baseUrl: 'http://ai:3000', token: 'internal-token-value' },
  },
}))

vi.mock('../../config', () => ({
  config: configMock,
}))

// 这三个只在构造函数里当注入令牌用，单测直接塞桩，不需要把真模块拉起来
vi.mock('@yikart/aitoearn-ai-client', () => ({ AitoearnAiClientService: class {} }))
vi.mock('@yikart/assets', () => ({ StorageProvider: class {} }))

interface ReadinessItemLike {
  key: string
  status: string
  required: boolean
  configPath: string | null
  detail: string | null
}

function findItem(items: ReadinessItemLike[], key: string): ReadinessItemLike {
  const item = items.find(entry => entry.key === key)
  if (!item)
    throw new Error(`没有返回 ${key} 这一项`)
  return item
}

function notFoundError() {
  return Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
}

describe('systemService', () => {
  let tmpRoot: string
  let getReadinessMock: ReturnType<typeof vi.fn>
  let headObjectMock: ReturnType<typeof vi.fn>

  function createService(): SystemService {
    return new SystemService(
      { ai: { getReadiness: getReadinessMock } } as never,
      { headObject: headObjectMock } as never,
    )
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    tmpRoot = mkdtempSync(join(tmpdir(), 'aitoearn-readiness-'))
    configMock.projects = { root: tmpRoot }
    configMock.notify = { enabled: false, barkUrl: '', barkKey: '', group: 'AiToEarn' }

    getReadinessMock = vi.fn().mockResolvedValue({
      items: [
        { key: 'agentUpstream', status: 'ok', required: true, configPath: 'agent.baseUrl', detail: null },
        { key: 'aiChatModels', status: 'ok', required: true, configPath: 'ai.models.chat', detail: null },
      ],
    })
    headObjectMock = vi.fn().mockRejectedValue(notFoundError())
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('五项齐全时 ready 为 true，且 key 和顺序固定', async () => {
    const result = await createService().getReadiness()

    expect(result.items.map(item => item.key)).toEqual([
      'agentUpstream',
      'aiChatModels',
      'assets',
      'projectsRoot',
      'notify',
    ])
    // notify 没配是 missing，但它 required=false，不拦人
    expect(findItem(result.items, 'notify').status).toBe('missing')
    expect(result.ready).toBe(true)
  })

  describe('ai 侧的两项', () => {
    it('原样透传 ai 给的结果', async () => {
      getReadinessMock.mockResolvedValue({
        items: [
          { key: 'agentUpstream', status: 'error', required: true, configPath: 'agent.baseUrl', detail: '上游返回 HTTP 401' },
          { key: 'aiChatModels', status: 'missing', required: true, configPath: 'ai.openai.apiKey', detail: '没配' },
        ],
      })

      const result = await createService().getReadiness()

      expect(findItem(result.items, 'agentUpstream').detail).toContain('401')
      expect(findItem(result.items, 'aiChatModels').configPath).toBe('ai.openai.apiKey')
      expect(result.ready).toBe(false)
    })

    it('ai 服务连不上时不抛错，两项都退化成 error', async () => {
      getReadinessMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.2:3000'))

      const result = await createService().getReadiness()

      expect(findItem(result.items, 'agentUpstream').status).toBe('error')
      expect(findItem(result.items, 'aiChatModels').status).toBe('error')
      expect(findItem(result.items, 'agentUpstream').detail).toContain('AI 服务的内部接口调不通')
      expect(findItem(result.items, 'assets').status).toBe('ok')
      expect(result.ready).toBe(false)
    })

    it('ai 少回了某一项也要有结果', async () => {
      getReadinessMock.mockResolvedValue({ items: [] })

      const result = await createService().getReadiness()

      expect(findItem(result.items, 'agentUpstream').status).toBe('error')
      expect(findItem(result.items, 'aiChatModels').status).toBe('error')
    })

    it('ai 回的 detail 里夹带了 Key，也会在这边被抹掉', async () => {
      getReadinessMock.mockResolvedValue({
        items: [
          {
            key: 'agentUpstream',
            status: 'error',
            required: true,
            configPath: 'agent.baseUrl',
            detail: 'rejected: sk-leaked-from-upstream and internal-token-value',
          },
        ],
      })

      const detail = findItem((await createService().getReadiness()).items, 'agentUpstream').detail

      expect(detail).not.toContain('sk-leaked-from-upstream')
      expect(detail).not.toContain('internal-token-value')
    })
  })

  describe('assets', () => {
    it('head 成功是 ok', async () => {
      headObjectMock.mockResolvedValue({ contentLength: 0 })

      expect(findItem((await createService().getReadiness()).items, 'assets').status).toBe('ok')
    })

    it('对象不存在也算 ok：请求发出去了、签名也认了', async () => {
      headObjectMock.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { code: 'NoSuchKey', status: 404 }))

      expect(findItem((await createService().getReadiness()).items, 'assets').status).toBe('ok')
    })

    it('连不上或者 Key 不对是 error，detail 不带 Key', async () => {
      headObjectMock.mockRejectedValue(
        new Error('InvalidAccessKeyId: super-secret-access-key is not valid'),
      )

      const result = await createService().getReadiness()
      const item = findItem(result.items, 'assets')

      expect(item.status).toBe('error')
      expect(item.detail).not.toContain('super-secret-access-key')
      expect(result.ready).toBe(false)
    })
  })

  describe('projectsRoot', () => {
    it('目录在且可写是 ok', async () => {
      expect(findItem((await createService().getReadiness()).items, 'projectsRoot').status).toBe('ok')
    })

    it('目录不存在是 missing', async () => {
      configMock.projects = { root: join(tmpRoot, 'not-here') }

      const item = findItem((await createService().getReadiness()).items, 'projectsRoot')

      expect(item.status).toBe('missing')
      expect(item.configPath).toBe('projects.root')
    })

    it('路径指向一个文件是 error', async () => {
      const filePath = join(tmpRoot, 'a-file')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(filePath, 'x')
      configMock.projects = { root: filePath }

      expect(findItem((await createService().getReadiness()).items, 'projectsRoot').status).toBe('error')
    })
  })

  // 只看配置齐不齐，不真发。就绪检查是进站自动跑的，顺手推一条等于每开一次网页震一下；
  // 真探活在设置页那个「发送测试通知」按钮上，那是人主动点的。所以这里没有 NotifyService。
  describe('notify', () => {
    it('没配就是 missing，不拦人', async () => {
      const item = findItem((await createService().getReadiness()).items, 'notify')

      expect(item.status).toBe('missing')
      expect(item.required).toBe(false)
    })

    it('配齐了就是 ok', async () => {
      configMock.notify = { enabled: true, barkUrl: 'https://bark.example.com/dev/', barkKey: 'bark-secret-key', group: 'AiToEarn' }

      const item = findItem((await createService().getReadiness()).items, 'notify')

      expect(item.status).toBe('ok')
    })

    it('总开关关着就算地址和 key 都在也是 missing', async () => {
      configMock.notify = { enabled: false, barkUrl: 'https://bark.example.com/dev/', barkKey: 'bark-secret-key', group: 'AiToEarn' }

      expect(findItem((await createService().getReadiness()).items, 'notify').status).toBe('missing')
    })
  })

  it('某一项探测自身炸了也出结果，其余项照常', async () => {
    headObjectMock.mockImplementation(() => {
      throw new Error('boom')
    })

    const result = await createService().getReadiness()

    expect(findItem(result.items, 'assets').status).toBe('error')
    expect(findItem(result.items, 'projectsRoot').status).toBe('ok')
    expect(findItem(result.items, 'notify').status).toBe('missing')
  })
})
