/**
 * SSRF 防护的判断规则。
 *
 * 这一组用例盯的是「哪些地址绝对不许发出去」——用户能在设置页填任意 `barkBaseUrl`，
 * 少挡一个网段就等于把内网开一条缝。规则要和 `apps/aitoearn-server` 侧的副本保持一致，
 * 两边的用例也应当是同一份。
 */
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeNotifyFailure, isBlockedIpAddress, NotifyRequestError, parseNotifyUrl, postNotifyRequest } from './notify.ssrf'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))

/**
 * **只把 DNS 解析换掉，发包全程是真 socket**。
 *
 * 为什么要换：本地靶子只能起在回环上，而「一个主机名这一次解析到哪个 IP」正是这组用例要摆布的东西
 * （旧连接、跳转、rebinding 都绕着它转）。解析之后的校验、钉 IP、建连接、发包全是真代码，
 * 断言也落在 net 层——到底建了几条连接、请求落在哪台靶子上。上一轮就是因为把发包整个打了桩才漏掉洞。
 *
 * 下面用 IP 字面量的用例压根不查 DNS，这个桩碰不到它们。
 */
vi.mock('node:dns/promises', async () => {
  const actual = await vi.importActual<typeof import('node:dns/promises')>('node:dns/promises')
  return { ...actual, lookup: (host: string, options?: unknown) => lookupMock(host, options) }
})

describe('ssrf · IP 网段判断', () => {
  it.each([
    ['回环', '127.0.0.1'],
    ['回环段里的别的地址', '127.13.14.15'],
    ['0.0.0.0', '0.0.0.0'],
    ['0.0.0.0/8 里的别的地址', '0.1.2.3'],
    ['私有 10/8', '10.0.0.1'],
    ['私有 172.16/12 起点', '172.16.0.1'],
    ['私有 172.16/12 终点', '172.31.255.254'],
    ['私有 192.168/16', '192.168.1.1'],
    ['链路本地', '169.254.1.1'],
    ['云元数据地址', '169.254.169.254'],
    ['运营商级 NAT', '100.64.0.1'],
    ['组播', '224.0.0.1'],
    ['保留段', '240.0.0.1'],
    ['广播', '255.255.255.255'],
    ['IPv6 未指定', '::'],
    ['IPv6 回环', '::1'],
    ['IPv6 唯一本地', 'fd00::1'],
    ['IPv6 唯一本地另一半', 'fc00::1'],
    ['IPv6 链路本地', 'fe80::1'],
    ['IPv6 组播', 'ff02::1'],
    // 这三条是最容易漏的绕过写法：换个写法照样打到回环和元数据
    ['IPv4-mapped 写法的回环', '::ffff:127.0.0.1'],
    ['6to4 写法的私有地址', '2002:0a00:0001::1'],
    ['IETF 协议保留段', '192.0.0.1'],
    ['IPv4-mapped 写法的元数据地址', '::ffff:169.254.169.254'],
    ['NAT64 写法的私有地址', '64:ff9b::10.0.0.1'],
    ['压根不是 IP', 'not-an-ip'],
    ['空字符串', ''],
  ])('拒绝：%s', (_, address) => {
    expect(isBlockedIpAddress(address)).toBe(true)
  })

  it.each([
    ['公网 IPv4', '1.1.1.1'],
    ['公网 IPv4（172 但不在私有段里）', '172.15.0.1'],
    ['公网 IPv4（172 私有段之后）', '172.32.0.1'],
    ['公网 IPv4（192 但不是 192.168）', '192.169.0.1'],
    ['公网 IPv4（192.0 但不在保留的 /24 里）', '192.0.3.1'],
    ['公网 IPv4（169 但不是 169.254）', '169.253.0.1'],
    ['公网 IPv6', '2001:4860:4860::8888'],
    ['IPv4-mapped 写法的公网地址', '::ffff:1.1.1.1'],
  ])('放行：%s', (_, address) => {
    expect(isBlockedIpAddress(address)).toBe(false)
  })
})

describe('ssrf · 地址解析', () => {
  it.each([
    ['file 协议', 'file:///etc/passwd'],
    ['gopher 协议', 'gopher://example.com/'],
    ['ftp 协议', 'ftp://example.com/'],
    ['根本不是 URL', 'bark.example.com/key/'],
    ['空字符串', ''],
  ])('拒绝：%s', (_, raw) => {
    expect(() => parseNotifyUrl(raw)).toThrow(NotifyRequestError)
    try {
      parseNotifyUrl(raw)
    }
    catch (error) {
      expect((error as NotifyRequestError).reason).toBe('invalid_url')
    }
  })

  it.each([
    ['https', 'https://bark.example.com/device-key/'],
    ['http', 'http://bark.example.com:8080/device-key/'],
  ])('放行：%s', (_, raw) => {
    expect(parseNotifyUrl(raw).hostname).toBe('bark.example.com')
  })

  it('抛出来的错误里不带原始地址', () => {
    try {
      parseNotifyUrl('file:///etc/passwd')
      expect.unreachable('应该抛错')
    }
    catch (error) {
      expect((error as Error).message).not.toContain('etc/passwd')
      expect((error as Error).message).toBe('invalid_url')
    }
  })
})

describe('ssrf · 真发一次请求', () => {
  let server: Server
  let port: number
  let received: Array<{ headers: IncomingHttpHeaders, body: string }>
  let respond: (req: IncomingMessage, res: ServerResponse) => void

  beforeEach(async () => {
    received = []
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"code":200}')
    }

    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
        respond(req, res)
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  const post = (options?: Partial<Parameters<typeof postNotifyRequest>[1]>) => postNotifyRequest(
    `http://127.0.0.1:${port}/device-key/`,
    {
      headers: { 'bark-key': 'header-key', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', body: 'b' }),
      allowPrivateAddress: true,
      ...options,
    },
  )

  it('放行内网时（.env 兜底通道）请求照常发出去，头和体都对', async () => {
    await expect(post()).resolves.toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0].headers['bark-key']).toBe('header-key')
    expect(JSON.parse(received[0].body)).toEqual({ title: 't', body: 'b' })
  })

  it('不放行内网时（用户填的地址）直接拒，一个包都不发出去', async () => {
    await expect(post({ allowPrivateAddress: false })).rejects.toMatchObject({ reason: 'blocked_address' })
    expect(received).toHaveLength(0)
  })

  it('重定向到元数据地址会被第二跳拦下', async () => {
    respond = (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
    }

    await expect(post()).rejects.toMatchObject({ reason: 'blocked_address' })
  })

  it('401 说明 key 不对，和别的 HTTP 错误分开', async () => {
    respond = (_req, res) => {
      res.writeHead(401)
      res.end()
    }

    await expect(post()).rejects.toMatchObject({ reason: 'unauthorized', status: 401 })
  })

  it('500 归到 http_error，带上状态码', async () => {
    respond = (_req, res) => {
      res.writeHead(500)
      res.end()
    }

    await expect(post()).rejects.toMatchObject({ reason: 'http_error', status: 500 })
  })

  it('对面不回就超时，不会一直挂着', async () => {
    respond = () => {}

    await expect(post({ timeoutMs: 300 })).rejects.toMatchObject({ reason: 'timeout' })
  })

  it('兜底通道跳回自己也要重新判：同主机不再是豁免，第二跳直接拒', async () => {
    // 内网豁免只对 `.env` 里那个初始地址生效，跳转一律按最严格的规则判，同主机名也不例外。
    // 跳数上限（too_many_redirects）要求每一跳都是公网地址，本机起不了公网靶子，
    // 那条分支由 aitoearn-server 侧同款用例（`notify.http.spec.ts` 的「一直转圈的对端」）覆盖。
    respond = (_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/device-key/` })
      res.end()
    }

    await expect(post()).rejects.toMatchObject({ reason: 'blocked_address' })
    expect(received).toHaveLength(1)
  })

  it('失败原因里不带地址、不带 key', async () => {
    respond = (_req, res) => {
      res.writeHead(500)
      res.end()
    }

    const error = await post().catch((err: NotifyRequestError) => err)
    const text = `${(error as Error).message} ${describeNotifyFailure(error)}`
    expect(text).not.toContain('127.0.0.1')
    expect(text).not.toContain('header-key')
    expect(text).not.toContain('device-key')
  })
})

/**
 * 用主机名发的那一组：**DNS 这一次回什么由测试说了算，发包还是真 socket**。
 *
 * 盯两件上一轮漏掉的事：
 * 1. 连接复用会把「用校验过的 IP 去连」整层绕开——池子按「主机名:端口」找旧连接，不看这次钉的 IP
 * 2. 内网豁免只对 `.env` 里那个初始地址生效，跳转一律重新判，同主机名也不例外
 *
 * 两台靶子占同一个端口的不同地址（`::1` 和 `127.0.0.1`），请求落在哪台，就说明真正连的是哪个 IP。
 */
describe('ssrf · 用主机名发：连的是这一跳校验出来的 IP', () => {
  interface Probe {
    server: Server
    connections: number
    received: Array<{ url: string, headers: IncomingHttpHeaders }>
  }

  const HOST = 'ops-bark.test'
  /** TEST-NET-3，文档保留段、路由不到任何真机器，这里只拿它当「一个公网地址」用 */
  const PUBLIC_ADDRESS = '203.0.113.10'

  let first: Probe
  let second: Probe
  let port: number
  let respond: (req: IncomingMessage, res: ServerResponse) => void

  const createProbe = (): Probe => {
    const probe: Probe = { server: undefined as unknown as Server, connections: 0, received: [] }
    probe.server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        probe.received.push({ url: req.url ?? '', headers: req.headers })
        respond(req, res)
      })
    })
    probe.server.on('connection', () => {
      probe.connections += 1
    })
    return probe
  }

  /**
   * 安排这个主机名解析到哪：第一跳回 `first`，之后每一跳回 `then`。
   *
   * 两个参数分开写是为了摆布「主机名没变、解析结果变了」——被抢注的域名、被劫持的链路、
   * rebinding，在服务端看到的都是这个形状。
   */
  const resolvesTo = (first: [string, 4 | 6], then: [string, 4 | 6] = first) => {
    lookupMock.mockReset()
    lookupMock.mockImplementation(async () => [{ address: then[0], family: then[1] }])
    lookupMock.mockResolvedValueOnce([{ address: first[0], family: first[1] }])
  }

  const push = (path: string, options?: Partial<Parameters<typeof postNotifyRequest>[1]>) => postNotifyRequest(
    `http://${HOST}:${port}${path}`,
    {
      headers: { 'bark-key': 'header-key', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', body: 'b' }),
      allowPrivateAddress: true,
      ...options,
    },
  )

  beforeEach(async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"code":200}')
    }
    lookupMock.mockReset()

    first = createProbe()
    second = createProbe()
    await new Promise<void>(resolve => first.server.listen(0, '::1', resolve))
    port = (first.server.address() as AddressInfo).port
    await new Promise<void>(resolve => second.server.listen(port, '127.0.0.1', resolve))
  })

  afterEach(async () => {
    for (const probe of [first, second]) {
      probe.server.closeAllConnections?.()
      await new Promise<void>(resolve => probe.server.close(() => resolve()))
    }
  })

  it('上一条推送留下的连接不会被下一条借走：第二条落在它自己校验出来的那台', async () => {
    // 这条盯的是「连到哪个 IP」，不是内网豁免：两台靶子都在回环上，所以两次都开着豁免，
    // 唯一的变量是这一次校验出来的地址。少了 `agent: false`，第二条会顺着第一条留下的连接
    // 发回第一台去——实测过，内网那台真的收到了带 bark-key 的 POST。
    resolvesTo(['::1', 6])
    await expect(push('/ops/')).resolves.toBe(200)

    resolvesTo(['127.0.0.1', 4])
    await expect(push('/user/')).resolves.toBe(200)

    expect(first.received.map(r => r.url)).toEqual(['/ops/'])
    expect(second.received.map(r => r.url)).toEqual(['/user/'])
    // 真的新建了连接，而不是复用旧的
    expect(second.connections).toBe(1)
  })

  it('连着推两条也各建各的连接：池子里没有能被借走的 socket', async () => {
    resolvesTo(['127.0.0.1', 4])

    await expect(push('/first/')).resolves.toBe(200)
    await expect(push('/second/')).resolves.toBe(200)

    expect(second.received.map(r => r.url)).toEqual(['/first/', '/second/'])
    expect(second.connections).toBe(2)
  })

  it('同主机的 302：主机名没变，但域名改指内网，第二跳照样拒', async () => {
    // 实测复现过的那条路：兜底地址先解析到能连的地方，对端回一个同主机名的 302，
    // 这中间域名改成解析到 169.254.169.254——以前同主机豁免会一路带下去，请求就带着 bark-key
    // 打进了云元数据。现在跳转没有任何豁免。
    // 第一跳解析到能连的地方，第二跳（同一个主机名）解析到云元数据
    resolvesTo(['127.0.0.1', 4], ['169.254.169.254', 4])
    respond = (_req, res) => {
      res.writeHead(302, { location: `http://${HOST}:${port}/second/` })
      res.end()
    }

    await expect(push('/ops/')).rejects.toMatchObject({ reason: 'blocked_address' })
    expect(second.received.map(r => r.url)).toEqual(['/ops/'])
    expect(first.received).toHaveLength(0)
  })

  it('同主机的 302 指向公网时照常跟：收走的只是内网豁免，不是跟跳转的能力', async () => {
    // 收紧之后不能把正常跳转也一起掐死：下一跳解析到公网地址，就不该被判成 blocked_address。
    // 那个地址是文档保留段，连不通（连都连不上，一个字节都发不出去），所以这里只看两件事：
    // 没被当成内网拒掉，而且请求没有落回本机这台。
    resolvesTo(['127.0.0.1', 4], [PUBLIC_ADDRESS, 4])
    respond = (_req, res) => {
      res.writeHead(302, { location: `http://${HOST}:${port}/second/` })
      res.end()
    }

    const outcome = await push('/ops/', { timeoutMs: 800 }).catch((error: unknown) => error)

    expect(describeNotifyFailure(outcome)).not.toContain('blocked_address')
    expect(second.received.map(r => r.url)).toEqual(['/ops/'])
    expect(first.received).toHaveLength(0)
  })
})

/**
 * 「什么算跳转」这件事本身就是攻击面：跟一跳，就等于把 `bark-key` 头再往一个**由对端指定**的地址
 * 发一次。所以这个集合必须和 aitoearn-server 的 `REDIRECT_STATUS` 逐个一致，
 * 否则同一个对端、同一个响应，两个服务一个跟一个不跟——差出来的那条路就是洞。
 *
 * 实测过差在哪：这边原先按「任何 3xx 带 Location 就跟」判，300 / 304 / 305 / 306 / 309
 * 会真的再发一次带 key 的请求，server 侧一个包都不发。危险方向两边都拦得住（指内网时这边也拒），
 * 差别在公网方向——这边多一条把 key 送出去的路。
 *
 * 而且这五个码从协议上本来就不该跟：300 多选、304 未修改（压根不是重定向）、
 * 305 用代理（已废弃，「拿这个代理去发你的请求」正是攻击方想要的）、306 已作废、309 未分配。
 *
 * 下面 300~309 十个码各跑一遍，靶子是真的本地服务器，**断言落在 net 层**：
 * 到底建了几条连接、靶子到底收到几个包、下一跳到底有没有被解析。
 *
 * 「跟的五个能一路跳到底并返回 200」那一半由 aitoearn-server 侧同款用例覆盖
 * （`notify.http.spec.ts` 的「跳转码白名单」）：那边能把第二跳也放在本地靶子上，
 * 这边跳转没有任何内网豁免，第二跳只要落在回环上就会被拒，本机又起不了公网靶子。
 */
describe('ssrf · 跳转码白名单：只认 301/302/303/307/308', () => {
  const HOST = 'ops-bark.test'
  /** TEST-NET-3，文档保留段、路由不到任何真机器，这里只拿它当「一个公网地址」用 */
  const PUBLIC_ADDRESS = '203.0.113.10'
  const FOLLOWED = [301, 302, 303, 307, 308]
  const NOT_FOLLOWED = [300, 304, 305, 306, 309]

  let server: Server
  let port: number
  let connections: number
  let received: Array<{ url: string, headers: IncomingHttpHeaders }>
  let status: number

  beforeEach(async () => {
    connections = 0
    received = []
    status = 200

    server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers })
        // 十个码回的 Location 是同一个，唯一的变量就是状态码本身
        res.writeHead(status, { location: `http://${HOST}:${port}/second/` })
        res.end()
      })
    })
    server.on('connection', () => {
      connections += 1
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
    lookupMock.mockReset()
  })

  afterEach(async () => {
    server.closeAllConnections?.()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  /** 第一跳解析到本地靶子，之后每一跳解析到 `then`——主机名没变，解析结果变了 */
  const resolvesTo = (then: [string, 4 | 6]) => {
    lookupMock.mockReset()
    lookupMock.mockImplementation(async () => [{ address: then[0], family: then[1] }])
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
  }

  const push = (code: number, timeoutMs = 1000) => {
    status = code
    return postNotifyRequest(`http://${HOST}:${port}/first/`, {
      headers: { 'bark-key': 'header-key', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', body: 'b' }),
      allowPrivateAddress: true,
      timeoutMs,
    })
  }

  it.each(FOLLOWED)('%i 会跟：下一跳重新解析、重新校验，指向元数据就在发出去之前拦下', async (code) => {
    resolvesTo(['169.254.169.254', 4])

    await expect(push(code)).rejects.toMatchObject({ reason: 'blocked_address' })

    // 解析了两次 = 第二跳确实走到了校验这一步，然后停在这里：带 bark-key 的包只出门了一次
    expect(lookupMock).toHaveBeenCalledTimes(2)
    expect(received.map(r => r.url)).toEqual(['/first/'])
    expect(connections).toBe(1)
  })

  it.each(NOT_FOLLOWED)('%i 不跟：当成普通 HTTP 错误收场，第二跳连解析都不会发生', async (code) => {
    resolvesTo(['169.254.169.254', 4])

    await expect(push(code)).rejects.toMatchObject({ reason: 'http_error', status: code })

    // 只解析了一次、只建了一条连接、靶子只收到一个包：这一跳之后什么都没再发生
    expect(lookupMock).toHaveBeenCalledTimes(1)
    expect(received.map(r => r.url)).toEqual(['/first/'])
    expect(connections).toBe(1)
  })

  it.each(FOLLOWED)('%i 指向公网时照常跟下去：收紧的是「哪些码算跳转」，不是跟跳转的能力', async (code) => {
    resolvesTo([PUBLIC_ADDRESS, 4])

    const outcome = await push(code, 400).catch((error: unknown) => error)
    const failure = describeNotifyFailure(outcome)

    // 那个地址是文档保留段，连都连不上，所以只看两件事：
    // 没被判成内网，也没被当成终态直接收场——也就是说它确实往下一跳去了
    expect(failure).not.toContain('blocked_address')
    expect(failure).not.toContain('http_error')
    expect(lookupMock).toHaveBeenCalledTimes(2)
    expect(received.map(r => r.url)).toEqual(['/first/'])
  })
})
