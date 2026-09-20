import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isBlockedAddress, NotifyUrlRejected, resolveAllowedUrl } from './notify-url.guard'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))

vi.mock('node:dns', async () => {
  const actual = await vi.importActual<typeof import('node:dns')>('node:dns')
  return {
    ...actual,
    default: actual,
    promises: { ...actual.promises, lookup: lookupMock },
  }
})

/**
 * 用户能在网页上填任意地址，服务端会拿着它去发请求。
 * 这一份就是那道闸：**漏一条网段，就等于开了一个从服务器内部发请求的口子**。
 *
 * 最要命的是 169.254.0.0/16——云厂商的实例元数据接口挂在 169.254.169.254，
 * 一次请求就能把这台机器的身份凭证读出去。
 */
describe('内网地址一律拒绝', () => {
  it.each([
    // 回环
    ['127.0.0.1'],
    ['127.1.2.3'],
    ['127.255.255.254'],
    // 未指定 / 本机
    ['0.0.0.0'],
    ['0.1.2.3'],
    // 私有网段
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.1'],
    ['172.20.10.5'],
    ['172.31.255.255'],
    ['192.168.0.1'],
    ['192.168.255.255'],
    // 链路本地：云元数据就在这一段
    ['169.254.169.254'],
    ['169.254.0.1'],
    ['169.254.255.255'],
    // 运营商级 NAT、IETF 保留、设备测试段
    ['100.64.0.1'],
    ['192.0.0.1'],
    ['198.18.0.1'],
    // 多播、保留、广播
    ['224.0.0.1'],
    ['239.255.255.250'],
    ['255.255.255.255'],
  ])('iPv4 %s 被拒', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    ['::1'], // 回环
    ['::'], // 未指定
    ['fe80::1'], // 链路本地
    ['fe80::a00:27ff:fe4e:66a1'],
    ['febf::1'], // fe80::/10 的上边界
    ['fc00::1'], // 唯一本地
    ['fd12:3456:789a::1'],
    ['ff02::1'], // 多播
    ['::ffff:127.0.0.1'], // IPv4-mapped，映射的是回环
    ['::ffff:169.254.169.254'], // 换成 IPv6 写法的云元数据地址
    ['::ffff:10.0.0.1'],
    ['::ffff:a9fe:a9fe'], // 同一个地址的十六进制写法
    ['::127.0.0.1'], // IPv4-compatible，已废弃但解析器还认
    ['64:ff9b::169.254.169.254'], // NAT64
    ['2002:a9fe:a9fe::1'], // 6to4，内嵌 169.254.169.254
  ])('iPv6 %s 被拒', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    ['1.1.1.1'],
    ['8.8.8.8'],
    ['203.0.113.10'],
    ['2606:4700:4700::1111'],
    ['2001:db8::1'],
  ])('公网地址 %s 放行', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false)
  })

  it('解析不出来的字符串当作不能请求：宁可误杀', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('')).toBe(true)
    expect(isBlockedAddress('999.999.999.999')).toBe(true)
  })
})

describe('地址校验', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it.each([
    ['ftp://bark.example.com/key/'],
    ['file:///etc/passwd'],
    ['gopher://bark.example.com/'],
    ['数据不是地址'],
    [''],
  ])('%s：协议不对或压根不是地址，直接拒', async (raw) => {
    await expect(resolveAllowedUrl(raw)).rejects.toMatchObject({ rejection: 'invalid' })
  })

  it.each([
    ['http://127.0.0.1/dev-key/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['https://[::1]/dev-key/'],
    ['http://[::ffff:169.254.169.254]/'],
    ['http://10.0.0.5:8080/dev-key/'],
  ])('%s：主机名本身就是内网 IP，不用查 DNS 就拒', async (raw) => {
    await expect(resolveAllowedUrl(raw)).rejects.toMatchObject({ rejection: 'blocked' })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('域名要解析出 IP 再判，不看名字长什么样', async () => {
    // 名字人畜无害，解析出来是云元数据地址
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])

    await expect(resolveAllowedUrl('https://bark.example.com/dev-key/'))
      .rejects
      .toMatchObject({ rejection: 'blocked' })
  })

  it('一个域名解出多个地址时，只要有一个是内网就整个拒', async () => {
    // split-horizon DNS 可以同时给公网和内网两个答案，挑一个能用的等于没防
    lookupMock.mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ])

    await expect(resolveAllowedUrl('https://bark.example.com/dev-key/'))
      .rejects
      .toMatchObject({ rejection: 'blocked' })
  })

  it('域名解析不出来就报解析失败，不当成能发', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))

    await expect(resolveAllowedUrl('https://bark.example.com/dev-key/'))
      .rejects
      .toMatchObject({ rejection: 'unresolvable' })
  })

  it('解析结果为空也算解析不出来', async () => {
    lookupMock.mockResolvedValue([])

    await expect(resolveAllowedUrl('https://bark.example.com/dev-key/'))
      .rejects
      .toMatchObject({ rejection: 'unresolvable' })
  })

  it('公网域名放行，并且把解析出来的 IP 带回去——发请求时连的就是它', async () => {
    lookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }])

    const allowed = await resolveAllowedUrl('https://bark.example.com/dev-key/')

    expect(allowed.address).toBe('203.0.113.10')
    expect(allowed.family).toBe(4)
    expect(allowed.url.hostname).toBe('bark.example.com')
  })

  it('拒绝时抛出来的错误里不带地址：它会进日志', async () => {
    const error = await resolveAllowedUrl('http://169.254.169.254/latest/').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NotifyUrlRejected)
    expect((error as Error).message).not.toContain('169.254')
  })
})
