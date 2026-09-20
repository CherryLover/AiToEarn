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
  /** net 层的连接数。`agent: false` 之后一跳一条连接，所以这个数就是「到底发了几次」 */
  let connections: number
  let handler: (request: { url: string }) => { status: number, headers?: Record<string, string>, body?: string }

  beforeEach(async () => {
    received = []
    connections = 0
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
    server.on('connection', () => {
      connections += 1
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
   * 「什么算跳转」本身就是攻击面：跟一跳，就等于把 `bark-key` 头再往一个**由对端指定**的地址
   * 发一次。所以 `REDIRECT_STATUS` 必须和 aitoearn-ai 的 `notify.ssrf.ts` 逐个一致，
   * 否则同一个对端、同一个响应，两个服务一个跟一个不跟——差出来的那条路就是洞。
   *
   * ai 侧原先按「任何 3xx 带 Location 就跟」判，实测 300 / 304 / 305 / 306 / 309
   * 那边会真的再发一次带 key 的请求，这边一个包都不发，后来按这一份收紧了。
   * 这一组把 300~309 十个码各跑一遍，**断言落在 net 层的连接数上**：到底建了几条连接、
   * 靶子到底收到几个包。ai 侧有一组同款用例（`notify.ssrf.spec.ts` 的「跳转码白名单」），
   * 两边的判定必须对得上。
   */
  describe('跳转码白名单：只认 301/302/303/307/308', () => {
    /** 这五个跟 */
    const FOLLOWED = [301, 302, 303, 307, 308]
    /** 这五个不跟。300 多选、304 未修改、305 用代理（已废弃）、306 已作废、309 未分配 */
    const NOT_FOLLOWED = [300, 304, 305, 306, 309]

    it.each(FOLLOWED)('%i 会跟：第二跳真的发出去了，而且是重新校验过才发的', async (code) => {
      handler = ({ url }) => (url === '/dev-key/'
        ? { status: code, headers: { location: '/second/' } }
        : { status: 200, body: '{}' })

      const response = await postGuardedJson(`${origin}/dev-key/`, { 'bark-key': 'header-key' }, '{}')

      expect(response.status).toBe(200)
      expect(received.map(r => r.url)).toEqual(['/dev-key/', '/second/'])
      expect(connections).toBe(2)
      // 第二跳是过了闸才发的，而且没继承任何豁免
      expect(resolveMock).toHaveBeenCalledTimes(2)
      expect(resolveMock).toHaveBeenLastCalledWith(`${origin}/second/`, { allowPrivateAddress: false })
    })

    it.each(NOT_FOLLOWED)('%i 不跟：状态码原样交回去，一个包都不发第二次', async (code) => {
      handler = () => ({ status: code, headers: { location: '/second/' } })

      const response = await postGuardedJson(`${origin}/dev-key/`, { 'bark-key': 'header-key' }, '{}')

      // 交回状态码，由 `classifyStatus` 判成推送失败，而不是当跳转再发一次
      expect(response.status).toBe(code)
      expect(received.map(r => r.url)).toEqual(['/dev-key/'])
      expect(connections).toBe(1)
      // 只解析了第一跳：第二跳连校验都没走到，更没发出去
      expect(resolveMock).toHaveBeenCalledTimes(1)
    })

    it.each(FOLLOWED)('%i 指向元数据地址：确实跟了，但在发出去之前被闸拦下', async (code) => {
      handler = () => ({ status: code, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })

      await expect(postGuardedJson(`${origin}/dev-key/`, { 'bark-key': 'header-key' }, '{}'))
        .rejects
        .toMatchObject({ rejection: 'blocked' })

      expect(received.map(r => r.url)).toEqual(['/dev-key/'])
      expect(connections).toBe(1)
      expect(resolveMock).toHaveBeenLastCalledWith(
        'http://169.254.169.254/latest/meta-data/',
        { allowPrivateAddress: false },
      )
    })

    it.each(NOT_FOLLOWED)('%i 指向元数据地址：压根不算跳转，那个地址连解析都不会发生', async (code) => {
      handler = () => ({ status: code, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })

      const response = await postGuardedJson(`${origin}/dev-key/`, { 'bark-key': 'header-key' }, '{}')

      expect(response.status).toBe(code)
      expect(received.map(r => r.url)).toEqual(['/dev-key/'])
      expect(connections).toBe(1)
      expect(resolveMock).toHaveBeenCalledTimes(1)
      expect(resolveMock).not.toHaveBeenCalledWith(
        'http://169.254.169.254/latest/meta-data/',
        expect.anything(),
      )
    })
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

    it('同主机的跳转也不继承放行：主机名没变，但下一跳照样按严格规则判', async () => {
      // 以前这里是「同主机就继承」，被实测绕过：兜底地址先解析到公网，对端回一个同主机名的 302，
      // 这中间把域名改成解析到 169.254.169.254，请求就带着 bark-key 进了云元数据。
      // 主机名一样不代表它解析到的地方一样，所以现在一跳都不继承。
      allowedHosts.clear()
      handler = ({ url }) => (url === '/dev-key/'
        ? { status: 302, headers: { location: '/dev-key/moved/' } }
        : { status: 200, body: '{}' })

      await expect(postGuardedJson(`${origin}/dev-key/`, {}, '{}', { allowPrivateAddress: true }))
        .rejects
        .toMatchObject({ rejection: 'blocked' })

      // 第一跳发出去了，第二跳在发之前就被拦住：bark-key 没跟着跳转再发一次
      expect(received.map(r => r.url)).toEqual(['/dev-key/'])
      expect(resolveMock).toHaveBeenLastCalledWith(
        `${origin}/dev-key/moved/`,
        { allowPrivateAddress: false },
      )
    })

    it('同主机的跳转指向公网时照常跟：收走的只是内网豁免，不是跟跳转的能力', async () => {
      // 收紧之后仍然要能用：地址解析到公网，302 还在同一个主机名下，
      // 第二跳走严格校验也过得去，通知照样送到。
      const { port } = server.address() as AddressInfo
      allowedHosts.clear()
      allowedHosts.add(`ops-bark.test:${port}`)
      handler = ({ url }) => (url === '/ops/'
        ? { status: 302, headers: { location: '/second/' } }
        : { status: 200, body: '{}' })

      const response = await postGuardedJson(
        `http://ops-bark.test:${port}/ops/`,
        {},
        '{}',
        { allowPrivateAddress: true },
      )

      expect(response.status).toBe(200)
      expect(received.map(r => r.url)).toEqual(['/ops/', '/second/'])
      expect(resolveMock).toHaveBeenLastCalledWith(
        `http://ops-bark.test:${port}/second/`,
        { allowPrivateAddress: false },
      )
    })

    it('初始地址是内网、对端不跳转：同机部署的 Bark 照常能用', async () => {
      allowedHosts.clear()

      const response = await postGuardedJson(`${origin}/dev-key/`, {}, '{}', { allowPrivateAddress: true })

      expect(response.status).toBe(200)
      expect(received.map(r => r.url)).toEqual(['/dev-key/'])
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

/**
 * 连接复用会把「用校验过的 IP 去连」这一层整个绕开。
 *
 * Node 的连接池按「主机名:端口」找旧连接，**不看这次校验出来的 IP**：只要之前往同一个主机名
 * 建过一条连接，后面这次哪怕校验完钉的是另一个 IP，请求也会顺着那条旧连接发回原来那台机器，
 * `pinnedLookup` 连调都不会被调到。实测过一次：兜底通道先往内网那台推了一条（合法），
 * 之后用户通道用同一个主机名推，校验层正确认定是公网并钉住了公网 IP，
 * 请求却落回了内网那台，头里还带着用户的 `bark-key`。
 *
 * 所以这一组不看返回值，**在 net 层数「建了几条连接、连到哪台」**：
 * 两台靶子占同一个端口的不同地址（`::1` 和 `127.0.0.1`），请求落在哪台就说明真正连的是哪个 IP。
 */
describe('不复用连接池：每次请求都连这一次校验出来的 IP', () => {
  interface Probe {
    server: Server
    connections: number
    received: Array<{ url: string, headers: Record<string, string | string[] | undefined> }>
  }

  const HOST = 'ops-bark.test'
  let internal: Probe
  let publicSide: Probe
  let port: number

  const createProbe = (): Probe => {
    const probe: Probe = { server: undefined as unknown as Server, connections: 0, received: [] }
    probe.server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        probe.received.push({ url: req.url ?? '', headers: req.headers })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    probe.server.on('connection', () => {
      probe.connections += 1
    })
    return probe
  }

  const pinTo = (address: string, family: 4 | 6) => {
    resolveMock.mockImplementation(async (raw: string) => ({ url: new URL(raw), address, family }))
  }

  beforeEach(async () => {
    internal = createProbe()
    publicSide = createProbe()
    await new Promise<void>(resolve => internal.server.listen(0, '::1', resolve))
    port = (internal.server.address() as AddressInfo).port
    await new Promise<void>(resolve => publicSide.server.listen(port, '127.0.0.1', resolve))
    resolveMock.mockReset()
  })

  afterEach(async () => {
    for (const probe of [internal, publicSide]) {
      probe.server.closeAllConnections?.()
      await new Promise<void>(resolve => probe.server.close(() => resolve()))
    }
    vi.restoreAllMocks()
  })

  it('上一条推送留下的连接不会被下一条借走：第二条落在它自己校验出来的那台', async () => {
    // 第一条：校验结果是 ::1（兜底通道打到内网那台），建起一条连接
    pinTo('::1', 6)
    await postGuardedJson(`http://${HOST}:${port}/ops/`, { 'bark-key': 'fallback-key' }, '{}', {
      allowPrivateAddress: true,
    })

    // 第二条：同一个主机名、同一个端口，但这次校验出来的是另一个 IP
    pinTo('127.0.0.1', 4)
    await postGuardedJson(`http://${HOST}:${port}/user/`, { 'bark-key': 'user-key' }, '{}')

    expect(internal.received.map(r => r.url)).toEqual(['/ops/'])
    expect(publicSide.received.map(r => r.url)).toEqual(['/user/'])
    // 真的新建了一条连接，而不是顺着旧的发出去
    expect(publicSide.connections).toBe(1)
    // 用户的 key 一个字节都没落到内网那台
    expect(internal.received.some(r => r.headers['bark-key'] === 'user-key')).toBe(false)
  })

  it('连着推两条也各建各的连接：池子里没有能被借走的 socket', async () => {
    pinTo('127.0.0.1', 4)

    await postGuardedJson(`http://${HOST}:${port}/first/`, {}, '{}')
    await postGuardedJson(`http://${HOST}:${port}/second/`, {}, '{}')

    expect(publicSide.received.map(r => r.url)).toEqual(['/first/', '/second/'])
    expect(publicSide.connections).toBe(2)
  })
})
