/**
 * `.env` 兜底通道的端到端用例：**全程走真网络**（起一个本地 http 服务收），不桩 fetch。
 *
 * 为什么不桩：这条通道原先用的是原生 `fetch`，桩掉之后「跟着 302 跑到内网」这件事根本测不出来
 * ——桩替代了真正跟随重定向的那一层。上一轮就是这么漏过去的。
 *
 * 用户自己配的那条通道在 `notify.user-config.spec.ts`，发包那一层在 `notify.http.spec.ts`。
 */
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_BODY_MAX, NOTIFY_TITLE_MAX } from './notify.format'
import { NotifyService } from './notify.service'

const { notifyConfig } = vi.hoisted(() => ({
  notifyConfig: {} as Record<string, unknown>,
}))

// notify.service 现在要读用户配置，会把 @yikart/mongodb 的 schema 全加载一遍；
// 测试环境下 @Prop 拿不到类型元数据，照 manual-publish-notify.spec.ts 的写法桩掉
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

// 真 config 要跑命令行参数解析，测试里起不来，照仓库现有写法整个桩掉
vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

interface Received {
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

describe('bark 推送（.env 兜底通道）', () => {
  let server: Server
  let origin: string
  let received: Received[]
  let handler: (request: { url: string }) => { status: number, headers?: Record<string, string>, body?: string }

  beforeEach(async () => {
    received = []
    handler = () => ({ status: 200, body: '{}' })

    server = createServer((req, res) => {
      let raw = ''
      req.on('data', chunk => (raw += chunk))
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers, body: raw })
        const result = handler({ url: req.url ?? '' })
        res.writeHead(result.status, { 'content-type': 'application/json', ...result.headers })
        res.end(result.body ?? '')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    origin = `http://127.0.0.1:${port}`

    for (const key of Object.keys(notifyConfig))
      delete notifyConfig[key]
    Object.assign(notifyConfig, {
      enabled: true,
      // 运维把 Bark 装在同机就是这个形态，兜底通道必须还能用
      barkUrl: `${origin}/device-key/`,
      barkKey: 'header-key',
      group: 'AiToEarn',
    })

    // 推送失败只记一行日志，测试里不需要看这些噪音
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function lastPayload() {
    return JSON.parse(received.at(-1)!.body) as { title: string, body: string, group: string }
  }

  describe('没配就静默跳过', () => {
    it.each([
      ['总开关关着', { enabled: false }],
      ['没填地址', { barkUrl: '' }],
      ['没填 key', { barkKey: '' }],
      ['整段都没配', { enabled: false, barkUrl: '', barkKey: '' }],
    ])('%s：一个请求都不发', async (_, patch) => {
      Object.assign(notifyConfig, patch)
      const notify = new NotifyService()

      expect(notify.enabled).toBe(false)
      await expect(notify.send({ title: '标题', body: '正文' })).resolves.toBe(false)
      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
      await expect(notify.notifyManualPublishPending({ platform: 'xhs' })).resolves.toBe(false)
      expect(received).toHaveLength(0)
    })
  })

  describe('请求本身', () => {
    it('post 到配置的地址，key 放在 bark-key 头里，分组带上', async () => {
      await expect(new NotifyService().send({ title: '标题', body: '正文' })).resolves.toBe(true)

      expect(received).toHaveLength(1)
      expect(received[0].url).toBe('/device-key/')
      expect(received[0].headers['bark-key']).toBe('header-key')
      expect(lastPayload()).toMatchObject({ title: '标题', body: '正文', group: 'AiToEarn' })
    })

    it('兜底通道不再走原生 fetch：它默认跟随重定向而且一跳都不校验', async () => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      await expect(new NotifyService().send({ title: '标题', body: '正文' })).resolves.toBe(true)

      expect(received).toHaveLength(1)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('内容被正确截断', () => {
    it('标题截到 30 字、正文截到 100 字，绝不原样投递', async () => {
      await new NotifyService().send({ title: '标'.repeat(80), body: '正'.repeat(500) })

      const payload = lastPayload()
      expect(Array.from(payload.title)).toHaveLength(NOTIFY_TITLE_MAX)
      expect(Array.from(payload.body)).toHaveLength(NOTIFY_BODY_MAX)
      expect(payload.title.endsWith('…')).toBe(true)
      expect(payload.body.endsWith('…')).toBe(true)
    })

    it('草稿正文很长时，推送里只留得下开头那一截', async () => {
      const sent = await new NotifyService().notifyDraftReady({
        projectName: 'fortyweeks',
        angle: 'pain-point',
        platform: 'xhs',
        draftTitle: '标'.repeat(300),
      })

      expect(sent).toBe(true)
      expect(lastPayload().title).toBe('✅ 新草稿生成好了')
      expect(Array.from(lastPayload().body)).toHaveLength(NOTIFY_BODY_MAX)
    })
  })

  /**
   * 这一组是这一轮修的那个洞（contract-settings 第五节）。
   *
   * 原来的实现对 `.env` 那条地址用原生 `fetch`：**默认跟随重定向，而且一跳都不校验**。
   * 把地址指向一个回 302 的端点，服务端就会老老实实跟过去，
   * 把请求连同 `bark-key` 头发到 302 指定的内网地址，还返回成功。
   *
   * 「地址是运维配的」不构成免检理由：明文 http、域名过期被抢注、链路被劫持，
   * 都能让那个端点回一个 302。
   */
  describe('兜底通道也要防 SSRF', () => {
    it('对端 302 指向云元数据地址：拒掉，第二跳一个包都没发出去', async () => {
      handler = () => ({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })

      const result = await new NotifyService().deliver({ title: '标题', body: '正文' })

      expect(result).toEqual({ success: false, failure: 'url_blocked' })
      // 只有第一跳到达了本地服务；bark-key 没有跟着跑去元数据地址
      expect(received).toHaveLength(1)
    })

    it.each([
      ['另一个私有网段', 'http://10.1.2.3/steal/'],
      ['IPv6 回环', 'http://[::1]:9/steal/'],
      ['IPv4-mapped 的元数据地址', 'http://[::ffff:169.254.169.254]/'],
    ])('302 指向%s也一样拒', async (_, location) => {
      handler = () => ({ status: 302, headers: { location } })

      const result = await new NotifyService().deliver({ title: '标题', body: '正文' })

      expect(result).toEqual({ success: false, failure: 'url_blocked' })
      expect(received).toHaveLength(1)
    })

    it('同主机的 302 还是跟：内网自建的 Bark 自己跳一下不能被打死', async () => {
      handler = ({ url }) => (url === '/device-key/'
        ? { status: 302, headers: { location: '/device-key/moved/' } }
        : { status: 200, body: '{}' })

      await expect(new NotifyService().send({ title: '标题', body: '正文' })).resolves.toBe(true)
      expect(received.map(item => item.url)).toEqual(['/device-key/', '/device-key/moved/'])
    })

    it('协议不是 http/https 的地址直接拒，不发包', async () => {
      notifyConfig.barkUrl = 'ftp://bark.example.com/device-key/'

      const result = await new NotifyService().deliver({ title: '标题', body: '正文' })

      expect(result).toEqual({ success: false, failure: 'url_invalid' })
      expect(received).toHaveLength(0)
    })
  })

  describe('发失败不影响主流程', () => {
    it('对端直接挂了也不抛错，主流程照跑', async () => {
      notifyConfig.barkUrl = 'http://127.0.0.1:1/never-listening/'

      await expect(new NotifyService().send({ title: '标题', body: '正文' })).resolves.toBe(false)
    })

    it('对端返回 500 也不抛错，只把原因带回来', async () => {
      handler = () => ({ status: 500, body: '{}' })

      const result = await new NotifyService().deliver({ title: '标题', body: '正文' })

      expect(result).toEqual({ success: false, failure: 'rejected', status: 500 })
    })

    it('对端说 key 不对（401）：认成 unauthorized', async () => {
      handler = () => ({ status: 401, body: '{}' })

      const result = await new NotifyService().deliver({ title: '标题', body: '正文' })

      expect(result).toEqual({ success: false, failure: 'unauthorized', status: 401 })
    })

    it('失败那行日志里不出现地址和 key', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      handler = () => ({ status: 500, body: '{}' })

      await new NotifyService().send({ title: '标题', body: '正文' })

      const logged = warn.mock.calls.flat().map(arg => String(arg)).join(' ')
      expect(logged).toContain('rejected')
      expect(logged).not.toContain('header-key')
      expect(logged).not.toContain('127.0.0.1')
    })
  })
})
