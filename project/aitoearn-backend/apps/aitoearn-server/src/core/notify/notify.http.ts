import type { LookupFunction } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { hostnameOf, resolveAllowedUrl } from './notify-url.guard'

/**
 * ⚠️⚠️ **这一份发包实现在 `apps/aitoearn-ai/src/core/notify/notify.ssrf.ts` 有一份等价副本**
 * （那边叫 `postNotifyRequest` / `sendOnce` / `pinnedLookup`）。**改这里必须同步改那里。**
 * 完整的对应表和「为什么还没合并成一份」写在 `notify-url.guard.ts` 的文件头。
 */

/** 一次推送（含跳转）最多等 5 秒。推送是旁支，不能把主流程的请求挂住 */
export const NOTIFY_TIMEOUT_MS = 5000

/** 最多跟几跳。Bark 常见的只有 http → https 一跳，给 3 跳足够 */
export const NOTIFY_MAX_REDIRECTS = 3

/** 响应体最多读这么多就掐掉。我们只关心状态码，正文纯粹是防对方拿一个无限流把内存撑爆 */
export const NOTIFY_MAX_RESPONSE_BYTES = 64 * 1024

/** 传输层失败的原因。**一个字都不带地址**，这些值会进日志、也会回给网页 */
export type NotifyTransportFailure = 'timeout' | 'unreachable' | 'too_many_redirects'

export class NotifyTransportError extends Error {
  constructor(readonly failure: NotifyTransportFailure) {
    super(`notify transport failed: ${failure}`)
    this.name = 'NotifyTransportError'
  }
}

export interface NotifyHttpResponse {
  status: number
}

/**
 * 把校验过的 IP 钉死给 socket。
 *
 * 这一步是「用解析结果连接」的落地：前面 `resolveAllowedUrl` 解析并校验过的地址，
 * 到这里直接交给 socket，中间不再给 DNS 第二次回答的机会（DNS rebinding 的常规做法就是
 * 第一次回公网 IP 骗过校验，第二次回内网 IP）。
 *
 * `options.host` 仍然是原来的域名，所以 TLS 的证书校验和 SNI 都还是按域名走，不会被绕过。
 */
function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  const lookup = (
    _hostname: string,
    options: unknown,
    callback: unknown,
  ) => {
    // net.connect 有时把 callback 塞在第二个参数上
    if (typeof options === 'function') {
      (options as (err: null, address: string, family: number) => void)(null, address, family)
      return
    }
    const done = callback as (
      err: null,
      address: string | Array<{ address: string, family: number }>,
      family?: number,
    ) => void

    if ((options as { all?: boolean } | undefined)?.all) {
      done(null, [{ address, family }])
      return
    }
    done(null, address, family)
  }

  return lookup as unknown as LookupFunction
}

interface HopResult {
  status: number
  location?: string
}

/** 发一跳。地址已经校验过，这里只管发和读 */
async function sendHop(
  target: Awaited<ReturnType<typeof resolveAllowedUrl>>,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<HopResult> {
  const isHttps = target.url.protocol === 'https:'
  const send = isHttps ? httpsRequest : httpRequest
  const payload = Buffer.from(body, 'utf8')

  return await new Promise<HopResult>((resolve, reject) => {
    let settled = false
    let deadline: NodeJS.Timeout
    const finish = (fn: () => void) => {
      if (settled)
        return
      settled = true
      clearTimeout(deadline)
      fn()
    }

    const req = send({
      protocol: target.url.protocol,
      host: hostnameOf(target.url),
      port: target.url.port || (isHttps ? 443 : 80),
      path: `${target.url.pathname}${target.url.search}`,
      method: 'POST',
      headers: {
        ...headers,
        'content-length': String(payload.byteLength),
      },
      lookup: pinnedLookup(target.address, target.family),
      // 不复用连接池：池里的 socket 是按「主机名:端口」找的，**根本不看这次校验出来的 IP**。
      // 只要之前往同一个主机名建过一条连接（比如兜底通道打到内网那台），后面这次哪怕
      // 校验完钉的是公网 IP，请求也会顺着那条旧连接发回内网去——上面那行 lookup 连调都不会被调。
      // 实测过：同一组输入，这边落到内网、ai 侧落到公网，两个服务给出了不同答案。
      agent: false,
    })

    // 整体超时。socket 级的 timeout 只管「静默多久」，接不住一个慢慢滴数据的对端
    deadline = setTimeout(() => {
      req.destroy()
      finish(() => reject(new NotifyTransportError('timeout')))
    }, timeoutMs)

    req.on('error', () => {
      // 错误对象里可能带着地址（ECONNREFUSED 1.2.3.4:443），一律不往上传
      finish(() => reject(new NotifyTransportError('unreachable')))
    })

    req.on('response', (res) => {
      const status = res.statusCode ?? 0
      const location = typeof res.headers.location === 'string' ? res.headers.location : undefined

      let read = 0
      res.on('data', (chunk: Buffer) => {
        read += chunk.byteLength
        if (read > NOTIFY_MAX_RESPONSE_BYTES)
          res.destroy()
      })
      const done = () => finish(() => resolve({ status, location }))
      res.on('end', done)
      res.on('close', done)
      res.on('error', done)
    })

    req.end(payload)
  })
}

/**
 * 算作「跳转」的状态码，**和 `apps/aitoearn-ai/src/core/notify/notify.ssrf.ts` 里那份逐个一致**。
 *
 * 跟一跳等于把 `bark-key` 头再往一个由对端指定的地址发一次，所以「什么算跳转」本身就是攻击面：
 * 两个服务对同一个响应必须给同一个答案。ai 侧原先按「任何 3xx 带 Location 就跟」判，
 * 实测 300 / 304 / 305 / 306 / 309 那边会真的再发一次带 key 的请求、这边一个包都不发，
 * 后来按这一份收紧了。**这个集合是两边对齐的，要改先去看那边。**
 *
 * 这五个码从协议上也本来就不该跟：300 多选、304 未修改（压根不是重定向）、
 * 305 用代理（已废弃，「拿这个代理去发你的请求」正是攻击方想要的）、306 已作废、309 未分配。
 */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export interface PostGuardedOptions {
  /** 总时长上限（含 DNS、连接、每一跳），默认 5 秒 */
  timeoutMs?: number
  /**
   * 放行内网地址，**只给 `.env` 兜底通道用**（运维可能把 Bark 装在同机）。
   *
   * **只对传进来的这个初始地址生效，一跳重定向都不继承**（连同主机名也不继承）。
   * 曾经按「同主机就继承」放过，实测被绕：兜底地址先解析到公网，对端回一个同主机名的 302，
   * 这中间把域名改成解析到 `169.254.169.254`，请求就带着 `bark-key` 打进了云元数据。
   * Location 是对端返回的内容，「运维信任这个地址」不等于「运维信任这个地址让我去打的任何地方」，
   * 同主机名也一样——主机名不变，它解析到哪完全由对方说了算。
   */
  allowPrivateAddress?: boolean
}

/**
 * 往一个地址 POST 一段 JSON，全程带 SSRF 校验。
 *
 * **用户填的地址和 `.env` 兜底地址走的都是这个函数**，区别只有 `allowPrivateAddress` 一个开关。
 * 兜底通道原先图省事用的是原生 `fetch`——`fetch` 默认自动跟随重定向而且一跳都不校验，
 * 实测把 `.env` 的地址指向一个回 302 的端点，服务端会老老实实跟过去，
 * 把请求连同 `bark-key` 头发到 302 指定的内网地址。明文 http、域名过期被抢注、链路被劫持，
 * 都能让那个端点回 302，所以「地址是运维配的」不构成跳过每一跳校验的理由（contract-settings 第五节）。
 *
 * **每一跳都重新校验，而且没有任何豁免**：第一跳过了不代表后面安全，对端回一个 302 指向
 * 169.254.169.254 就把前面的校验全绕过去了。所以循环里每次都走一遍 `resolveAllowedUrl`，
 * 并且 `allowPrivateAddress` 只在第 0 跳有效——同主机名的 302 也不继承，
 * 因为主机名不变不代表它解析到的地方不变（contract-settings 第五节）。
 *
 * 跳转一律沿用 POST 和原请求体：这是推一条通知，不是浏览器导航，
 * 按 303 改 GET 只会让通知丢掉。
 *
 * 失败时抛 `NotifyUrlRejected` 或 `NotifyTransportError`，**两者都不带地址**。
 */
export async function postGuardedJson(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  options: PostGuardedOptions = {},
): Promise<NotifyHttpResponse> {
  const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS
  const startedAt = Date.now()
  let current = rawUrl
  const allowPrivateInitialAddress = options.allowPrivateAddress ?? false

  for (let hop = 0; hop <= NOTIFY_MAX_REDIRECTS; hop++) {
    const remaining = timeoutMs - (Date.now() - startedAt)
    if (remaining <= 0)
      throw new NotifyTransportError('timeout')

    // 内网放行只对第 0 跳（`.env` 里那个地址）生效，后面每一跳都按最严格的规则判
    const target = await resolveAllowedUrl(current, {
      allowPrivateAddress: hop === 0 && allowPrivateInitialAddress,
    })
    const result = await sendHop(target, headers, body, remaining)

    if (!REDIRECT_STATUS.has(result.status) || !result.location)
      return { status: result.status }

    let next: URL
    try {
      next = new URL(result.location, target.url)
    }
    catch {
      // 对端给了个解析不了的 Location，就当这次推送到此为止
      return { status: result.status }
    }

    current = next.toString()
  }

  throw new NotifyTransportError('too_many_redirects')
}
