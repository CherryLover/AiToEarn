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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeNotifyFailure, isBlockedIpAddress, NotifyRequestError, parseNotifyUrl, postNotifyRequest } from './notify.ssrf'

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

  it('绕圈的重定向会被截住', async () => {
    respond = (_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/device-key/` })
      res.end()
    }

    await expect(post()).rejects.toMatchObject({ reason: 'too_many_redirects' })
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
