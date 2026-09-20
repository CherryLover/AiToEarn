import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

/**
 * ⚠️⚠️ **这套 SSRF 判断在 `apps/aitoearn-ai/src/core/notify/notify.ssrf.ts` 有一份等价副本。**
 * ⚠️⚠️ **改这里必须同步改那里，否则两个服务对同一个地址给出不同答案，就是一个洞。**
 *
 * 对应关系（函数名不同，逻辑必须一致）：
 *
 * | 这里（server） | aitoearn-ai 的 notify.ssrf.ts |
 * |---|---|
 * | `isBlockedAddress` / `isBlockedIpv4` / `isBlockedIpv6` / `embeddedIpv4` | `isBlockedIpAddress` / 同名函数 |
 * | `resolveAllowedUrl` | `parseNotifyUrl` + `resolveAllowedAddress` |
 * | `notify.http.ts` 的 `postGuardedJson` / `sendHop` / `pinnedLookup` | `postNotifyRequest` / `sendOnce` / `pinnedLookup` |
 *
 * **为什么还没合并成一份**：正确做法是提到 `libs/common` 里两边一起 import，但那要动两个应用之外的
 * 目录，牵连面比这一轮该承担的大（libs 是所有应用共享的，改一次全量重编 + 全量回归）。
 * 这一轮只做行为对齐，抽取留给下一轮；做抽取的人记得把两处副本一起删掉。
 * 在那之前，**网段名单和放行规则是逐条对齐过的，改之前先去看那边**。
 *
 * ---
 *
 * 用户填的推送地址的 SSRF 防护（contract-settings 第四节）。
 *
 * **为什么这一份是重点**：`barkBaseUrl` 是用户在网页上随便填的，服务端会拿着它去发 HTTP 请求。
 * 不拦的话，等于对外开放了一个「以服务器身份、从内网发请求」的口子——
 * 最典型的就是 `http://169.254.169.254/`，云厂商的元数据接口就挂在那，
 * 一次请求就能把这台机器的实例身份凭证读出去。
 *
 * 三条实现要点：
 * 1. **解析出 IP 之后再判断**，不看域名字符串。`metadata.internal` 这种名字看着人畜无害，
 *    解析出来是 169.254.169.254
 * 2. **每一跳都判**。只校验第一跳，对方回一个 302 指向内网就白防了（见 notify.http.ts）
 * 3. **用解析结果去连**。校验完再让 socket 自己解析一次，中间这段时间 DNS 可以改答案
 *    （DNS rebinding）。所以这里把解析结果带出去，发请求时用它建连接
 */

/** 校验不通过的原因。给调用方翻成错误码 / 给「发送测试通知」显示，**不带地址本身 */
export type NotifyUrlRejection = 'invalid' | 'blocked' | 'unresolvable'

export class NotifyUrlRejected extends Error {
  constructor(readonly rejection: NotifyUrlRejection) {
    // 这里绝不能把地址拼进 message：message 会进日志
    super(`notify url rejected: ${rejection}`)
    this.name = 'NotifyUrlRejected'
  }
}

/** 校验通过的地址，以及**真正要连的那个 IP */
export interface AllowedNotifyUrl {
  url: URL
  /** DNS 解析出来并逐个校验过的地址，发请求时连它 */
  address: string
  /** 4 或 6 */
  family: 4 | 6
}

/** 把 IPv4 文本转成 4 个字节 */
function ipv4ToBytes(ip: string): number[] | null {
  if (isIP(ip) !== 4)
    return null
  return ip.split('.').map(Number)
}

/**
 * 把 IPv6 文本转成 16 个字节。
 *
 * 先用 `isIP` 确认格式合法，所以下面可以按合法输入来解析。
 * 末尾的点分十进制（`::ffff:169.254.169.254`）先折成两组十六进制再走通用流程。
 */
function ipv6ToBytes(ip: string): number[] | null {
  if (isIP(ip) !== 6)
    return null

  // 去掉 zone id：fe80::1%eth0
  let text = ip.split('%')[0]

  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = ipv4ToBytes(tail)
    if (!v4)
      return null
    const high = ((v4[0] << 8) | v4[1]).toString(16)
    const low = ((v4[2] << 8) | v4[3]).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }

  const halves = text.split('::')
  if (halves.length > 2)
    return null

  const head = halves[0] ? halves[0].split(':') : []
  let groups: string[]
  if (halves.length === 1) {
    groups = head
  }
  else {
    const rest = halves[1] ? halves[1].split(':') : []
    const fill = 8 - head.length - rest.length
    if (fill < 0)
      return null
    groups = [...head, ...Array.from({ length: fill }, () => '0'), ...rest]
  }

  if (groups.length !== 8)
    return null

  const bytes: number[] = []
  for (const group of groups) {
    const value = Number.parseInt(group, 16)
    if (Number.isNaN(value))
      return null
    bytes.push((value >> 8) & 0xFF, value & 0xFF)
  }
  return bytes
}

/**
 * IPv4 的拒绝名单。
 *
 * 契约点名要拒的：回环、10./172.16-31./192.168.、169.254.（云元数据）、0.0.0.0。
 * 另外补上同样不该从公网服务往里打的几段：CGNAT、IETF 保留、benchmark、多播和保留段。
 */
function isBlockedIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes

  if (a === 0) // 0.0.0.0/8，含 0.0.0.0 本身（很多协议栈把它当「本机」）
    return true
  if (a === 10) // 10.0.0.0/8
    return true
  if (a === 127) // 127.0.0.0/8 回环
    return true
  if (a === 169 && b === 254) // 169.254.0.0/16 链路本地——云元数据就在这
    return true
  if (a === 172 && b >= 16 && b <= 31) // 172.16.0.0/12
    return true
  if (a === 192 && b === 168) // 192.168.0.0/16
    return true
  if (a === 192 && b === 0 && c === 0) // 192.0.0.0/24 IETF 协议保留
    return true
  if (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 运营商级 NAT
    return true
  if (a === 198 && (b === 18 || b === 19)) // 198.18.0.0/15 网络设备测试
    return true
  if (a >= 224) // 224/4 多播 + 240/4 保留（含 255.255.255.255 广播）
    return true

  return false
}

/**
 * 从 IPv6 里抠出内嵌的 IPv4。
 *
 * `::ffff:169.254.169.254` 是个 IPv6 地址，但连上去打的是 169.254.169.254。
 * 不抠出来按 IPv4 规则再判一遍，等于留了一个绕过口。
 */
function embeddedIpv4(bytes: number[]): number[] | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every(x => x === 0)

  // ::ffff:a.b.c.d  IPv4-mapped
  if (zeros(0, 10) && bytes[10] === 0xFF && bytes[11] === 0xFF)
    return bytes.slice(12)
  // ::a.b.c.d  IPv4-compatible（已废弃，但解析器还认）
  if (zeros(0, 12))
    return bytes.slice(12)
  // 64:ff9b::/96  NAT64
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xFF && bytes[3] === 0x9B && zeros(4, 12))
    return bytes.slice(12)
  // 2002::/16  6to4，内嵌 IPv4 在第 3~6 字节
  if (bytes[0] === 0x20 && bytes[1] === 0x02)
    return bytes.slice(2, 6)

  return null
}

/** IPv6 的拒绝名单，含内嵌 IPv4 的回查 */
function isBlockedIpv6(bytes: number[]): boolean {
  const embedded = embeddedIpv4(bytes)
  if (embedded && isBlockedIpv4(embedded))
    return true

  if (bytes.every(x => x === 0)) // ::  未指定地址
    return true
  if (bytes.slice(0, 15).every(x => x === 0) && bytes[15] === 1) // ::1 回环
    return true
  if ((bytes[0] & 0xFE) === 0xFC) // fc00::/7 唯一本地地址（fc / fd）
    return true
  if (bytes[0] === 0xFE && (bytes[1] & 0xC0) === 0x80) // fe80::/10 链路本地
    return true
  if (bytes[0] === 0xFF) // ff00::/8 多播
    return true

  return false
}

/**
 * 这个 IP 能不能请求。
 *
 * **解析不出来的一律当作不能**：宁可误杀，也不放一个判不了的地址过去。
 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const bytes = ipv4ToBytes(ip)
    return bytes === null || isBlockedIpv4(bytes)
  }
  if (family === 6) {
    const bytes = ipv6ToBytes(ip)
    return bytes === null || isBlockedIpv6(bytes)
  }
  return true
}

/** 把 URL 里的主机名取出来，IPv6 字面量的方括号要去掉 */
export function hostnameOf(url: URL): string {
  const host = url.hostname
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

export interface ResolveAllowedUrlOptions {
  /**
   * 放行内网地址。
   *
   * **只给服务器 `.env` 那份兜底配置用**：那个地址是运维自己写进
   * `/opt/stack/aitoearn/.env` 的，线上就有把 Bark 装在同机、写成 `http://127.0.0.1:.../` 的用法，
   * 一刀切拦掉等于把既有部署打死。判断依据是「配置来源可不可信」，不是「地址长什么样」。
   *
   * **但它只跟着同一个主机名走**：换了主机的重定向一律重新按严格规则判，见 `notify.http.ts`。
   * 这个开关**永远不许透出到任何接口参数上**，用户填的地址没有商量余地。
   */
  allowPrivateAddress?: boolean
}

/**
 * 校验一个用户填的地址，**并把要连的 IP 一起带回来**。
 *
 * - 协议只认 http / https
 * - 主机名本身就是 IP 的，直接判
 * - 是域名的，解析出全部地址，**只要有一个落在拒绝名单里就整个拒掉**
 *   （split-horizon DNS 可以同时给公网和内网两个答案，挑一个能用的等于没防）
 *
 * `allowPrivateAddress` 只放宽「网段判断」这一条，协议白名单和「解析不出来就拒」照旧，
 * 解析结果照旧带出去钉给 socket——放行的是地址本身，不是整套防护。
 */
export async function resolveAllowedUrl(
  raw: string,
  options: ResolveAllowedUrlOptions = {},
): Promise<AllowedNotifyUrl> {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new NotifyUrlRejected('invalid')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new NotifyUrlRejected('invalid')

  const hostname = hostnameOf(url)
  if (!hostname)
    throw new NotifyUrlRejected('invalid')

  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) {
    if (!options.allowPrivateAddress && isBlockedAddress(hostname))
      throw new NotifyUrlRejected('blocked')
    return { url, address: hostname, family: literalFamily as 4 | 6 }
  }

  let records: Array<{ address: string, family: number }>
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  }
  catch {
    throw new NotifyUrlRejected('unresolvable')
  }

  if (!records.length)
    throw new NotifyUrlRejected('unresolvable')

  if (!options.allowPrivateAddress) {
    for (const record of records) {
      if (isBlockedAddress(record.address))
        throw new NotifyUrlRejected('blocked')
    }
  }

  const chosen = records[0]
  return {
    url,
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  }
}
