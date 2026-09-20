import type { ClientRequest } from 'node:http'
import type { LookupFunction } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, isIPv4 } from 'node:net'

/**
 * 对「用户自己填的推送地址」发请求的安全通道（contract-settings 第四节「SSRF 必须防」）。
 *
 * 用户能在设置页填任意 `barkBaseUrl`，服务端会去请求它。不防的话，这就是一个
 * 「从服务器内部发任意请求」的口子：`http://169.254.169.254/` 是云厂商的元数据地址，
 * `http://10.x.x.x/` 是内网，一旦能打，等于把内网暴露给任何一个注册用户。
 *
 * ---
 *
 * ## ⚠️⚠️ 这套判断在 aitoearn-server 侧有一份等价副本，**改这里必须同步改那里**
 *
 * 副本在 `apps/aitoearn-server/src/core/notify/notify-url.guard.ts` 和 `notify.http.ts`。
 * 两个应用之间没有共享代码的 lib（和 `notify.format.ts` / `notify.config.ts` 是同一个处境，
 * 参照 `project-workspace.service.ts` 的同款处理）。server 侧的设置页接口
 * （`GET/POST /settings/notify`、`POST /settings/notify/test`）用的是同一套规则，
 * 否则会出现「设置页说这个地址不让填，AI 服务却照发」这种两边不一致的洞。
 *
 * 对应关系：
 *
 * | 这里 | aitoearn-server |
 * |---|---|
 * | `isBlockedIpAddress` / `isBlockedIpv4` / `isBlockedIpv6` / `embeddedIpv4` | `notify-url.guard.ts` 里的同名函数 |
 * | `parseNotifyUrl` + `resolveAllowedAddress` | `notify-url.guard.ts` 的 `resolveAllowedUrl` |
 * | `postNotifyRequest` + `sendOnce` + `pinnedLookup` | `notify.http.ts` 的 `postGuardedJson` / `sendHop` / `pinnedLookup` |
 * | `PostNotifyOptions.allowPrivateAddress` | `PostGuardedOptions.allowPrivateAddress` |
 * | `REDIRECT_STATUS`（哪些码算跳转） | `notify.http.ts` 的 `REDIRECT_STATUS`，**必须是同一个集合** |
 *
 * **网段名单、放行规则、跳转码名单都是逐条对齐过的，改之前先去看那边。** 已经栽过两次：
 * 一次是 server 的 `.env` 兜底通道图省事走原生 `fetch`，自动跟随重定向且一跳都不校验，
 * 同一个 302 场景这边拦得住、那边照跟；一次是这边把「任何 3xx 带 Location」都当跳转，
 * 300 / 304 / 305 / 306 / 309 这边真的会再发一次带 `bark-key` 的请求、那边一个包都不发。
 * 两次都是同一个形状：两个服务对同一个响应给出了不同答案，差出来的那条路就是洞。
 *
 * **为什么还没合并成一份**：正确做法是把这套判断提到 `libs/common` 里两边一起 import，
 * 但那要动两个应用之外的目录（libs 是所有应用共享的，改一次全量重编 + 全量回归），
 * 牵连面比这一轮该承担的大。这一轮只做行为对齐，抽取留给下一轮；
 * 做抽取的人记得把两处副本一起删掉。
 *
 * ---
 *
 * 防护分四层，缺一层都能被绕：
 *
 * 1. **协议白名单**：只放 `http` / `https`。`file:`、`gopher:`、`ftp:` 一律拒
 * 2. **解析出 IP 之后再判**：光看域名没用，`localtest.me` 这种域名解析出来就是 127.0.0.1
 * 3. **用解析结果连接**：拿到通过校验的 IP 之后，把它钉死在 socket 的 `lookup` 上。
 *    不钉的话，校验用的那次解析和真正连接用的那次解析是两次独立的 DNS 查询，
 *    攻击方把 TTL 设成 0 就能让第二次返回内网地址（DNS rebinding）
 * 4. **每一跳重定向都重新判，而且没有任何豁免**：`https://evil.example/` 返回 302 指向
 *    `http://169.254.169.254/`，只判第一跳等于没判。所以这里不让底层自动跟随重定向，
 *    自己一跳一跳来；`.env` 兜底通道的内网放行也只对初始地址有效，同主机名的 302 一样不继承
 */

/** 一次推送最多等 5 秒（含 DNS、连接、重定向在内的总时长）。推送是旁支，不能让它把主流程的请求挂住 */
export const NOTIFY_TIMEOUT_MS = 5000

/** 最多跟 3 跳重定向，再多就当对面在绕圈 */
export const NOTIFY_MAX_REDIRECTS = 3

/** 响应体最多读 64KB。Bark 只回一小段 JSON，读多了只会给自己找麻烦 */
export const NOTIFY_MAX_RESPONSE_BYTES = 64 * 1024

/**
 * 失败原因。**只有这些固定字符串会进日志和接口返回**，
 * 绝不把地址、主机名、解析出来的 IP、`bark-key` 带出去。
 */
export type NotifyFailureReason
  = | 'invalid_url' // 压根不是个合法的 http/https 地址
    | 'blocked_address' // 解析出来的地址落在回环 / 私有 / 链路本地等禁止网段
    | 'dns_failed' // 域名解析不出来
    | 'too_many_redirects' // 重定向绕太多圈
    | 'timeout' // 超时
    | 'unauthorized' // 401 / 403：key 不对
    | 'http_error' // 其它 HTTP 错误状态
    | 'network_error' // 连不上、被拒、证书不过、对端断开

/**
 * 推送失败。
 *
 * `message` 故意只放 `reason`：这个错误会被日志打出去，
 * 带上原始地址或底层 error 的文本（里面常有主机名和 IP）就等于泄露用户配置。
 */
export class NotifyRequestError extends Error {
  readonly reason: NotifyFailureReason
  readonly status?: number

  constructor(reason: NotifyFailureReason, status?: number) {
    super(status === undefined ? reason : `${reason}:${status}`)
    this.name = 'NotifyRequestError'
    this.reason = reason
    this.status = status
  }
}

/**
 * 这个 IPv4 地址是不是禁止访问的。
 *
 * 一行一个网段，方便和 server 侧的副本逐行 diff。**加网段只能往严了加，不能放宽。**
 */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    return true // 解析不出来就当不安全

  const [a, b, c] = parts

  if (a === 0)
    return true // 0.0.0.0/8 「本网络」，含 0.0.0.0 本身
  if (a === 10)
    return true // 10.0.0.0/8 私有
  if (a === 127)
    return true // 127.0.0.0/8 回环
  if (a === 100 && b >= 64 && b <= 127)
    return true // 100.64.0.0/10 运营商级 NAT
  if (a === 169 && b === 254)
    return true // 169.254.0.0/16 链路本地 —— 云元数据 169.254.169.254 就在这
  if (a === 172 && b >= 16 && b <= 31)
    return true // 172.16.0.0/12 私有
  if (a === 192 && b === 0 && c === 0)
    return true // 192.0.0.0/24 IETF 协议专用
  if (a === 192 && b === 168)
    return true // 192.168.0.0/16 私有
  if (a === 198 && (b === 18 || b === 19))
    return true // 198.18.0.0/15 网络设备基准测试
  if (a >= 224)
    return true // 224.0.0.0/4 组播 + 240.0.0.0/4 保留 + 255.255.255.255 广播

  return false
}

/**
 * 把 IPv6 字面量拆成 16 个字节。拆不出来返回 null（调用方当作不安全）。
 *
 * 不用现成库：这段判断必须和 server 侧一字不差，少一个依赖就少一处会走偏的地方。
 */
function ipv6ToBytes(address: string): Uint8Array | null {
  // 去掉 `%eth0` 这种 zone id
  let head = address.split('%')[0]

  // 结尾可能是内嵌的点分四段（`::ffff:1.2.3.4`），先换算成两个十六进制组
  const lastColon = head.lastIndexOf(':')
  if (lastColon >= 0) {
    const tail = head.slice(lastColon + 1)
    if (tail.includes('.')) {
      if (!isIPv4(tail))
        return null
      const [q1, q2, q3, q4] = tail.split('.').map(Number)
      head = `${head.slice(0, lastColon + 1)}${(((q1 << 8) | q2) >>> 0).toString(16)}:${(((q3 << 8) | q4) >>> 0).toString(16)}`
    }
  }

  const halves = head.split('::')
  if (halves.length > 2)
    return null

  const toGroups = (text: string) => (text.length === 0 ? [] : text.split(':').map(g => Number.parseInt(g, 16)))
  const left = toGroups(halves[0])
  const right = halves.length === 2 ? toGroups(halves[1]) : []

  let groups: number[]
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 0)
      return null
    groups = [...left, ...Array.from({ length: missing }, () => 0), ...right]
  }
  else {
    groups = left
  }

  if (groups.length !== 8 || groups.some(g => !Number.isInteger(g) || g < 0 || g > 0xFFFF))
    return null

  const bytes = new Uint8Array(16)
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8
    bytes[index * 2 + 1] = group & 0xFF
  })
  return bytes
}

/**
 * IPv6 里内嵌的 IPv4（有就取出来，按 IPv4 的规矩重新判一遍）。
 *
 * 不处理这一层的话，`::ffff:127.0.0.1` 这种写法可以直接绕过所有 IPv6 判断打到回环。
 */
function embeddedIpv4(bytes: Uint8Array): string | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every(byte => byte === 0)
  const quad = () => `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`

  // ::ffff:0:0/96 IPv4-mapped
  if (zeros(0, 10) && bytes[10] === 0xFF && bytes[11] === 0xFF)
    return quad()

  // 64:ff9b::/96 NAT64
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xFF && bytes[3] === 0x9B && zeros(4, 12))
    return quad()

  // ::/96 IPv4-compatible（已废弃但仍能解析）。`::` 和 `::1` 交给下面的专门判断
  if (zeros(0, 12) && !(bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && bytes[15] <= 1))
    return quad()

  // 2002::/16 6to4，内嵌的 IPv4 在第 3~6 字节
  if (bytes[0] === 0x20 && bytes[1] === 0x02)
    return `${bytes[2]}.${bytes[3]}.${bytes[4]}.${bytes[5]}`

  return null
}

function isBlockedIpv6(address: string): boolean {
  const bytes = ipv6ToBytes(address)
  if (!bytes)
    return true // 解析不出来就当不安全

  const embedded = embeddedIpv4(bytes)
  if (embedded)
    return isBlockedIpv4(embedded)

  if (bytes.every(byte => byte === 0))
    return true // :: 未指定地址
  if (bytes.slice(0, 15).every(byte => byte === 0) && bytes[15] === 1)
    return true // ::1 回环
  if ((bytes[0] & 0xFE) === 0xFC)
    return true // fc00::/7 唯一本地（相当于 IPv6 的私有网段）
  if (bytes[0] === 0xFE && (bytes[1] & 0xC0) === 0x80)
    return true // fe80::/10 链路本地
  if (bytes[0] === 0xFF)
    return true // ff00::/8 组播

  return false
}

/** 这个 IP 字面量是不是禁止访问的。认不出来的一律当作禁止 */
export function isBlockedIpAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4)
    return isBlockedIpv4(address)
  if (version === 6)
    return isBlockedIpv6(address)
  return true
}

/**
 * 把用户填的字符串解析成 URL，顺带卡掉协议。
 *
 * @throws NotifyRequestError `invalid_url`
 */
export function parseNotifyUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new NotifyRequestError('invalid_url')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new NotifyRequestError('invalid_url')

  if (!url.hostname)
    throw new NotifyRequestError('invalid_url')

  return url
}

export interface PinnedAddress {
  address: string
  family: 4 | 6
}

/** URL 里的 IPv6 主机名带方括号（`[::1]`），拿去判断前得剥掉 */
function bareHostname(url: URL): string {
  const host = url.hostname
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

async function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NotifyRequestError('timeout')), Math.max(timeoutMs, 0))
      }),
    ])
  }
  finally {
    if (timer)
      clearTimeout(timer)
  }
}

/**
 * 解析主机名并校验，返回一个可以直接连的地址。
 *
 * **所有解析结果都要过校验，不是挑一个能用的就行**：一个域名同时返回公网和内网两条 A 记录时，
 * 「挑第一个过校验的」会被轮询解析绕过去，所以只要有一条落在禁止网段，整个地址就拒。
 *
 * @throws NotifyRequestError `blocked_address` / `dns_failed` / `timeout`
 */
export async function resolveAllowedAddress(
  url: URL,
  options: { timeoutMs: number, allowPrivateAddress?: boolean },
): Promise<PinnedAddress> {
  const host = bareHostname(url)
  const literal = isIP(host)

  if (literal) {
    if (!options.allowPrivateAddress && isBlockedIpAddress(host))
      throw new NotifyRequestError('blocked_address')
    return { address: host, family: literal === 4 ? 4 : 6 }
  }

  let resolved: Array<{ address: string, family: number }>
  try {
    resolved = await withDeadline(dnsLookup(host, { all: true, verbatim: true }), options.timeoutMs)
  }
  catch (error) {
    if (error instanceof NotifyRequestError)
      throw error
    throw new NotifyRequestError('dns_failed')
  }

  if (resolved.length === 0)
    throw new NotifyRequestError('dns_failed')

  if (!options.allowPrivateAddress && resolved.some(entry => isBlockedIpAddress(entry.address)))
    throw new NotifyRequestError('blocked_address')

  const first = resolved[0]
  return { address: first.address, family: first.family === 6 ? 6 : 4 }
}

/** 把 socket 的 DNS 解析钉死在已经校验过的地址上 */
function pinnedLookup(pinned: PinnedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options?.all)
      callback(null, [{ address: pinned.address, family: pinned.family }])
    else
      callback(null, pinned.address, pinned.family)
  }
}

interface SingleHopResult {
  status: number
  location?: string
}

/**
 * 发一跳。连接被钉死在 `pinned` 上：SNI、Host 头、证书校验还是按域名走，只有 TCP 连的那个 IP 被固定。
 */
function sendOnce(
  url: URL,
  pinned: PinnedAddress,
  init: { headers: Record<string, string>, body: string },
  timeoutMs: number,
): Promise<SingleHopResult> {
  return new Promise<SingleHopResult>((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const send = isHttps ? httpsRequest : httpRequest
    const payload = Buffer.from(init.body, 'utf8')

    // 超时和请求互相要对方（超时要掐请求，请求回来要撤超时），所以先声明再赋值
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let request: ClientRequest | undefined

    const finish = (fn: () => void) => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      fn()
    }

    timer = setTimeout(() => {
      finish(() => {
        request?.destroy()
        reject(new NotifyRequestError('timeout'))
      })
    }, Math.max(timeoutMs, 1))

    request = send({
      protocol: url.protocol,
      hostname: bareHostname(url),
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        ...init.headers,
        'content-length': String(payload.byteLength),
      },
      // 这一行就是第 3 层防护：只连刚校验过的那个 IP，不给第二次 DNS 解析任何机会。
      // `all` 要分开处理：Node 开了 autoSelectFamily 之后是带 all:true 调进来的，回调要给数组
      lookup: pinnedLookup(pinned),
      // 不复用连接池：池里的 socket 是按「主机名:端口」找的，**不看这次校验出来的 IP**，
      // 有一条旧连接就把上面那行 lookup 整个绕过去。server 侧当初漏了这一行，
      // 实测同一组输入两个服务把请求发去了不同主机。**这一行不能删。**
      agent: false,
    }, (response) => {
      let received = 0
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > NOTIFY_MAX_RESPONSE_BYTES)
          response.destroy()
      })
      const done = () => finish(() => resolve({
        status: response.statusCode ?? 0,
        location: typeof response.headers.location === 'string' ? response.headers.location : undefined,
      }))
      response.on('end', done)
      // 体读到一半断了也认状态码：状态码已经拿到了，body 对推送来说没用
      response.on('close', done)
      response.on('error', done)
    })

    request.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => reject(new NotifyRequestError(error?.code === 'ETIMEDOUT' ? 'timeout' : 'network_error')))
    })

    request.write(payload)
    request.end()
  })
}

/**
 * 算作「跳转」的状态码，**和 aitoearn-server 的 `notify.http.ts` 里那份逐个一致**。
 *
 * 跟一跳等于把 `bark-key` 头再往一个由对端指定的地址发一次，所以「什么算跳转」本身就是攻击面：
 * 两个服务对同一个响应必须给同一个答案，差出来的那条路就是洞。这里原先按
 * 「任何 3xx 带 Location 就跟」判，实测 300 / 304 / 305 / 306 / 309 这五个码
 * 这边会真的再发一次带 key 的请求，server 侧一个包都不发。
 *
 * 这五个码从协议上也本来就不该跟：300 多选、304 未修改（压根不是重定向）、
 * 305 用代理（已废弃，「拿这个代理去发你的请求」正是攻击方想要的）、306 已作废、309 未分配。
 * 不在名单里的一律当终态，交给下面的状态码分类去收场。
 */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export interface PostNotifyOptions {
  headers: Record<string, string>
  body: string
  timeoutMs?: number
  /**
   * 放行内网地址。
   *
   * **只给服务器 `.env` 里那份兜底配置用**：那个地址是运维自己填进
   * `/opt/stack/aitoearn/.env` 的，可能本来就是内网自建的 Bark，不是攻击面。
   * 用户在设置页填的地址永远走校验，这个开关不许透出到任何接口参数上。
   *
   * **它只对传进来的这个初始地址生效，一跳重定向都不继承**（连同主机名也不继承），
   * 见 `postNotifyRequest` 里的说明。
   */
  allowPrivateAddress?: boolean
}

/**
 * 往用户填的地址 POST 一段 JSON。成功返回 HTTP 状态码，失败抛 {@link NotifyRequestError}。
 *
 * 超时是**总时长**：DNS、连接、每一跳重定向共用同一个 deadline，
 * 不然「3 跳 × 5 秒」就能把 5 秒的承诺变成 15 秒。
 */
export async function postNotifyRequest(rawUrl: string, options: PostNotifyOptions): Promise<number> {
  const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs

  let target = parseNotifyUrl(rawUrl)
  /**
   * 内网放行**只对 `.env` 里那个初始地址生效，任何一跳重定向都不继承**。
   *
   * 以前是「同主机名就继承」，实测被绕：兜底地址 `http://ops-bark.test/ops/` 先解析到公网，
   * 对端回一个同主机名的 302（`http://ops-bark.test/second/`），这中间把域名改成解析到
   * `169.254.169.254`，服务就照直连了上去，`bark-key` 跟着进了云元数据。
   * 主机名一样不代表它解析到的地方一样，而 Location 本来就是对端说了算的内容——
   * 「运维信任这个地址」不等于「运维信任这个地址让我去打的任何地方」
   * （contract-settings 第五节：兜底通道每一跳都要校验）。
   *
   * 同机部署的 Bark 照样能用：初始地址是内网就直接放行，只是它一旦 302 到别处，
   * 下一跳就按最严格的规则判。
   */
  const allowPrivateInitialAddress = options.allowPrivateAddress ?? false

  for (let hop = 0; hop <= NOTIFY_MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0)
      throw new NotifyRequestError('timeout')

    const pinned = await resolveAllowedAddress(target, {
      timeoutMs: remaining,
      allowPrivateAddress: hop === 0 && allowPrivateInitialAddress,
    })

    const result = await sendOnce(target, pinned, options, deadline - Date.now())

    // 只有名单里的五个码才算跳转，别的 3xx 一律当终态：见 `REDIRECT_STATUS` 上面的说明
    const isRedirect = REDIRECT_STATUS.has(result.status) && result.location
    if (!isRedirect) {
      if (result.status === 401 || result.status === 403)
        throw new NotifyRequestError('unauthorized', result.status)
      if (result.status < 200 || result.status >= 300)
        throw new NotifyRequestError('http_error', result.status)
      return result.status
    }

    // 下一跳重新解析、重新校验。相对地址按当前这一跳的地址展开
    let next: URL
    try {
      next = new URL(result.location!, target)
    }
    catch {
      throw new NotifyRequestError('invalid_url')
    }

    target = parseNotifyUrl(next.toString())
  }

  throw new NotifyRequestError('too_many_redirects')
}

/**
 * 把任意异常收敛成一句能进日志的话。
 *
 * **这是日志安全的最后一道闸**：底层 error 的 message 里常常带着主机名和 IP
 * （`connect ECONNREFUSED 10.0.0.3:443`），直接打出去就把用户的推送地址泄露了，
 * 所以这里只输出固定枚举，认不出来的一律写 `unknown_error`。
 */
export function describeNotifyFailure(error: unknown): string {
  if (error instanceof NotifyRequestError)
    return error.status === undefined ? error.reason : `${error.reason}(${error.status})`
  return 'unknown_error'
}
