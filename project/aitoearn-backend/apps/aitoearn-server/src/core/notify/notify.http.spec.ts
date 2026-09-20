import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isBlockedAddress, NotifyUrlRejected } from './notify-url.guard'
import { NOTIFY_MAX_REDIRECTS, NotifyTransportError, postGuardedJson } from './notify.http'

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }))

/**
 * 只把 `resolveAllowedUrl` 换掉，别的（网段判断、错误类型）都用真的。
 *
 * 为什么非换不可：本地测试服务器只能起在 127.0.0.1 上，而 127.0.0.1 恰好是这道闸要拦的地址。
 * 真校验会把第一跳就拦下来，就测不到「跟着跳转走到内网」这件事了。
 * 所以这里只对测试服务器那个 host 放行，其余地址照样走真判断——
 * 也就是说下面「跳转到 169.254.169.254 被拒」这条，拒它的是真代码，不是桩。
 */
vi.mock('./notify-url.guard', async () => {
  const actual = await vi.importActual<typeof import('./notify-url.guard')>('./notify-url.guard')
  return {
    ...actual,
    resolveAllowedUrl: (raw: string, options?: { allowPrivateAddress?: boolean }) => resolveMock(raw, options),
  }
})

describe('带 SSRF 校验的推送请求', () => {
  let server: Server
  let origin: string
  let allowedHosts: Set<string>
  let received: Array<{ url: string, headers: Record<string, string | string[] | undefined>, body: string }>
  let handler: (request: { url: string }) => { status: number, headers?: Record<string, string>, body?: string }

  beforeEach(async () => {
    received = []
    allowedHosts = new Set()
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
    allowedHosts.add(`127.0.0.1:${port}`)

    resolveMock.mockReset()
    resolveMock.mockImplementation(async (raw: string, options?: { allowPrivateAddress?: boolean }) => {
      const url = new URL(raw)
      if (allowedHosts.has(url.host))
        return { url, address: '127.0.0.1', family: 4 as const }

      const hostname = url.hostname.replace(/^\[|\]$/g, '')
      if (!options?.allowPrivateAddress && isBlockedAddress(hostname))
        throw new NotifyUrlRejected('blocked')
      return { url, address: hostname, family: 4 as const }
    })
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.restoreAllMocks()
  })

  it('正常一跳：POST 过去，头和请求体原样到达', async () => {
    const response = await postGuardedJson(
      `${origin}/dev-key/`,
      { 'bark-key': 'header-key', 'content-type': 'application/json' },
      JSON.stringify({ title: '标题', body: '正文' }),
    )

    expect(response.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0].url).toBe('/dev-key/')
    expect(received[0].headers['bark-key']).toBe('header-key')
    expect(JSON.parse(received[0].body)).toEqual({ title: '标题', body: '正文' })
  })

  it('用域名时连的是校验过的那个 IP，Host 头还是域名', async () => {
    // 这一条是「用解析结果连接」的落地检查：地址写成域名，socket 却必须连到
    // 校验时解析出来的那个 IP，中间不给 DNS 第二次回答的机会（DNS rebinding）。
    // 主机名是 IP 字面量时 Node 根本不查 DNS，所以只有用域名才测得到这段。
    const { port } = server.address() as AddressInfo
    allowedHosts.add(`bark.test:${port}`)

    const response = await postGuardedJson(`http://bark.test:${port}/dev-key/`, {}, '{}')

    expect(response.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0].headers.host).toBe(`bark.test:${port}`)
  })

  it('跳转到云元数据地址：拒掉，而且一个请求都没发过去', async () => {
    handler = () => ({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })

    await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}'))
      .rejects
      .toMatchObject({ rejection: 'blocked' })

    // 第一跳发出去了，第二跳在发之前就被拦住
    expect(received).toHaveLength(1)
    expect(resolveMock).toHaveBeenCalledTimes(2)
    expect(resolveMock).toHaveBeenLastCalledWith(
      'http://169.254.169.254/latest/meta-data/',
      { allowPrivateAddress: false },
    )
  })

  it.each([
    ['回环', 'http://127.0.0.1:9/'],
    ['私有网段', 'http://10.1.2.3/'],
    ['IPv6 回环', 'http://[::1]/'],
    ['IPv4-mapped 的元数据地址', 'http://[::ffff:169.254.169.254]/'],
  ])('跳转到%s也一样拒', async (_, location) => {
    handler = () => ({ status: 307, headers: { location } })

    await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}'))
      .rejects
      .toBeInstanceOf(NotifyUrlRejected)
  })

  it('相对路径的跳转按当前地址拼，接着跟', async () => {
    handler = ({ url }) => (url === '/dev-key/'
      ? { status: 302, headers: { location: '/moved/' } }
      : { status: 200, body: '{}' })

    const response = await postGuardedJson(`${origin}/dev-key/`, {}, '{}')

    expect(response.status).toBe(200)
    expect(received.map(r => r.url)).toEqual(['/dev-key/', '/moved/'])
  })

  it('跳转时沿用 POST 和原请求体：这是推通知，不是浏览器导航', async () => {
    handler = ({ url }) => (url === '/dev-key/'
      ? { status: 303, headers: { location: '/moved/' } }
      : { status: 200, body: '{}' })

    await postGuardedJson(`${origin}/dev-key/`, {}, JSON.stringify({ title: '标题' }))

    expect(received[1].body).toBe(JSON.stringify({ title: '标题' }))
  })

  it('一直转圈的对端：转够次数就放弃，不会无限跟下去', async () => {
    handler = () => ({ status: 302, headers: { location: `${origin}/loop/` } })

    await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}'))
      .rejects
      .toMatchObject({ failure: 'too_many_redirects' })
    expect(received).toHaveLength(NOTIFY_MAX_REDIRECTS + 1)
  })

  it('对端一直不回：超时，不会把调用方挂住', async () => {
    server.removeAllListeners('request')
    server.on('request', () => { /* 收下不回，模拟卡死 */ })

    const error = await postGuardedJson(`${origin}/dev-key/`, {}, '{}', { timeoutMs: 120 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NotifyTransportError)
    expect((error as NotifyTransportError).failure).toBe('timeout')
  })

  it('连不上的端口：报连不上，错误里不带地址', async () => {
    allowedHosts.add('127.0.0.1:1')

    const error = await postGuardedJson('http://127.0.0.1:1/dev-key/', {}, '{}').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NotifyTransportError)
    expect((error as NotifyTransportError).failure).toBe('unreachable')
    expect((error as Error).message).not.toContain('127.0.0.1')
  })

  it('对端回一大坨正文也不会把内存撑爆：读到上限就掐掉，照样拿到状态码', async () => {
    handler = () => ({ status: 200, body: 'x'.repeat(512 * 1024) })

    const response = await postGuardedJson(`${origin}/dev-key/`, {}, '{}')

    expect(response.status).toBe(200)
  })

  it('默认不放行本机地址：上面那些放行全靠测试自己开的口子', async () => {
    allowedHosts.clear()

    await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}'))
      .rejects
      .toMatchObject({ rejection: 'blocked' })
    expect(received).toHaveLength(0)
  })

  /**
   * `.env` 兜底通道用的就是这个开关（`notify.service.ts` 里 `source === 'env'` 时打开）。
   * 它只放宽「地址本身能不能是内网」，**不放宽每一跳都要校验这件事**。
   */
  describe('allowPrivateAddress：只给 .env 兜底通道用', () => {
    it('打开时本机地址能发出去：运维把 Bark 装在同机的既有部署不能被打死', async () => {
      allowedHosts.clear()

      const response = await postGuardedJson(
        `${origin}/dev-key/`,
        {},
        '{}',
        { allowPrivateAddress: true },
      )

      expect(response.status).toBe(200)
      expect(received).toHaveLength(1)
    })

    it('同主机的跳转继承放行：内网 Bark 自己补个斜杠还能用', async () => {
      allowedHosts.clear()
      handler = ({ url }) => (url === '/dev-key/'
        ? { status: 302, headers: { location: '/dev-key/moved/' } }
        : { status: 200, body: '{}' })

      const response = await postGuardedJson(`${origin}/dev-key/`, {}, '{}', { allowPrivateAddress: true })

      expect(response.status).toBe(200)
      expect(received.map(r => r.url)).toEqual(['/dev-key/', '/dev-key/moved/'])
    })

    it('换了主机的跳转不继承放行：302 指向元数据地址照样被拒', async () => {
      allowedHosts.clear()
      handler = () => ({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })

      await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}', { allowPrivateAddress: true }))
        .rejects
        .toMatchObject({ rejection: 'blocked' })

      // 第二跳在发出去之前就被拦住：bark-key 头没跟着跑到内网去
      expect(received).toHaveLength(1)
      expect(resolveMock).toHaveBeenLastCalledWith(
        'http://169.254.169.254/latest/meta-data/',
        { allowPrivateAddress: false },
      )
    })

    it('换了主机的跳转即使还在内网也不继承：换成另一个私有网段一样拒', async () => {
      allowedHosts.clear()
      handler = () => ({ status: 307, headers: { location: 'http://10.1.2.3/steal/' } })

      await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}', { allowPrivateAddress: true }))
        .rejects
        .toBeInstanceOf(NotifyUrlRejected)
      expect(received).toHaveLength(1)
    })
  })
})
