import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_BODY_MAX, NOTIFY_TITLE_MAX } from './notify.format'
import { NotifyService } from './notify.service'

const { notifyConfig } = vi.hoisted(() => ({
  notifyConfig: {
    enabled: true,
    barkUrl: 'https://bark.example.com/device-key/',
    barkKey: 'header-key',
    group: 'AiToEarn',
  },
}))

// 真 config 要跑命令行参数解析，测试里起不来，照仓库现有写法整个桩掉
vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

describe('bark 推送', () => {
  let service: NotifyService
  let fetchMock: ReturnType<typeof vi.fn>

  function lastRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return { url, init, body: JSON.parse(init.body as string) as Record<string, string> }
  }

  beforeEach(() => {
    Object.assign(notifyConfig, {
      enabled: true,
      barkUrl: 'https://bark.example.com/device-key/',
      barkKey: 'header-key',
      group: 'AiToEarn',
    })

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    // 推送失败只记一行日志，测试里不需要看这些噪音
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function createService() {
    service = new NotifyService()
    return service
  }

  describe('没配就静默跳过', () => {
    it.each([
      ['总开关关着', { enabled: false }],
      ['没填地址', { barkUrl: '' }],
      ['没填 key', { barkKey: '' }],
      ['整段都没配', { enabled: false, barkUrl: '', barkKey: '' }],
    ])('%s：一个请求都不发', async (_, patch) => {
      Object.assign(notifyConfig, patch)
      const notify = createService()

      expect(notify.enabled).toBe(false)
      await expect(notify.send({ title: '标题', body: '正文' })).resolves.toBe(false)
      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
      await expect(notify.notifyManualPublishPending({ platform: 'xhs' })).resolves.toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('发失败不影响主流程', () => {
    it('网络直接炸了也不抛错，只返回 false', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
      const notify = createService()

      await expect(notify.send({ title: '标题', body: '正文' })).resolves.toBe(false)
    })

    it('超时（AbortError）也不抛错', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }))
      const notify = createService()

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
    })

    it('对端返回 4xx / 5xx 也不抛错', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 })
      const notify = createService()

      await expect(notify.send({ title: '标题', body: '正文' })).resolves.toBe(false)
    })

    it('带了 5 秒超时，不会把调用方的请求挂住', async () => {
      const notify = createService()
      await notify.send({ title: '标题', body: '正文' })

      expect(lastRequest().init.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('内容被正确截断', () => {
    it('标题截到 30 字、正文截到 100 字，绝不原样投递', async () => {
      const notify = createService()
      await notify.send({ title: '标'.repeat(80), body: '正'.repeat(500) })

      const { body } = lastRequest()
      expect(Array.from(body.title)).toHaveLength(NOTIFY_TITLE_MAX)
      expect(Array.from(body.body)).toHaveLength(NOTIFY_BODY_MAX)
      expect(body.title.endsWith('…')).toBe(true)
      expect(body.body.endsWith('…')).toBe(true)
    })

    it('草稿正文很长时，推送里只留得下开头那一截', async () => {
      const notify = createService()
      await notify.notifyDraftReady({
        projectName: 'fortyweeks',
        angle: 'pain-point',
        platform: 'xhs',
        draftTitle: '标'.repeat(300),
      })

      expect(Array.from(lastRequest().body.body)).toHaveLength(NOTIFY_BODY_MAX)
    })
  })

  describe('请求本身', () => {
    it('post 到配置的地址，key 放在 bark-key 头里，分组带上', async () => {
      const notify = createService()
      await notify.send({ title: '标题', body: '正文' })

      const { url, init, body } = lastRequest()
      expect(url).toBe('https://bark.example.com/device-key/')
      expect(init.method).toBe('POST')
      expect(init.headers).toMatchObject({ 'bark-key': 'header-key', 'content-type': 'application/json' })
      expect(body).toMatchObject({ title: '标题', body: '正文', group: 'AiToEarn' })
    })
  })

  describe('真的发出去一次（起一个本地 http 服务收）', () => {
    beforeEach(() => {
      // 这一组要走真 fetch，把上面的桩撤掉
      vi.unstubAllGlobals()
    })

    it('对端收到的就是截断过的标题正文、bark-key 头和分组', async () => {
      const received: Array<{ headers: Record<string, string | string[] | undefined>, body: string }> = []
      const server = createServer((req, res) => {
        let raw = ''
        req.on('data', chunk => (raw += chunk))
        req.on('end', () => {
          received.push({ headers: req.headers, body: raw })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{}')
        })
      })

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      notifyConfig.barkUrl = `http://127.0.0.1:${port}/device-key/`

      try {
        const sent = await createService().notifyDraftReady({
          projectName: 'fortyweeks',
          angle: 'pain-point',
          platform: 'xhs',
          draftTitle: '标'.repeat(300),
        })

        expect(sent).toBe(true)
        expect(received).toHaveLength(1)
        expect(received[0].headers['bark-key']).toBe('header-key')

        const payload = JSON.parse(received[0].body) as { title: string, body: string, group: string }
        expect(payload.title).toBe('✅ 新草稿生成好了')
        expect(payload.group).toBe('AiToEarn')
        expect(Array.from(payload.body)).toHaveLength(NOTIFY_BODY_MAX)
      }
      finally {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    })

    it('对端直接挂了也不抛错，主流程照跑', async () => {
      notifyConfig.barkUrl = 'http://127.0.0.1:1/never-listening/'

      await expect(createService().send({ title: '标题', body: '正文' })).resolves.toBe(false)
    })
  })
})
