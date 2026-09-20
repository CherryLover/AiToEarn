/**
 * 设置页工具函数
 * 只做纯计算：Bark 地址的前端预校验、服务端错误码与测试失败原因到人话文案的映射、
 * 以及「现在到底有没有一条通道能把通知发出去」。
 *
 * **前端校验不是安全边界。** 真正挡住内网地址、云元数据地址、重定向逃逸的是服务端
 * （contract-settings 第四节的 SSRF 要求）。这里拦一遍只为了让用户当场看到提示，
 * 别等提交完才知道填错了。服务端说不行就是不行，以服务端返回的错误码为准。
 */

import type { NotifySetting } from '@/api/settings/notify.types'
import {
  NOTIFY_BARK_BASE_URL_MAX_LENGTH,
  NOTIFY_ERROR_CODE,
  NOTIFY_GROUP_MAX_LENGTH,
} from '@/api/settings/notify.constants'
import { NotifyTestFailure } from '@/api/settings/notify.types'

/** 只允许这两种协议 */
const ALLOWED_PROTOCOLS = ['http:', 'https:']

/** 一眼可判的本机 / 内网主机名 */
const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', '[::]', '[::1]']

/** IPv4 四段 */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * 判断一个 IPv4 是否落在回环 / 私有 / 链路本地网段。
 * 链路本地 169.254.0.0/16 里就有云元数据地址 169.254.169.254，必须一起挡。
 */
function isBlockedIpv4(hostname: string): boolean {
  const matched = IPV4_PATTERN.exec(hostname)
  if (!matched)
    return false

  const parts = matched.slice(1, 5).map(Number)
  if (parts.some(part => Number.isNaN(part) || part > 255))
    return true

  const [a, b] = parts

  // 0.0.0.0/8 未指定、127.0.0.0/8 回环
  if (a === 0 || a === 127)
    return true
  // 10.0.0.0/8 私有
  if (a === 10)
    return true
  // 172.16.0.0/12 私有
  if (a === 172 && b >= 16 && b <= 31)
    return true
  // 192.168.0.0/16 私有
  if (a === 192 && b === 168)
    return true
  // 169.254.0.0/16 链路本地，云元数据地址在这里
  if (a === 169 && b === 254)
    return true

  return false
}

/** IPv6 字面量在 URL 里带方括号，这里判回环、唯一本地 fc00::/7、链路本地 fe80::/10 */
function isBlockedIpv6(hostname: string): boolean {
  if (!hostname.startsWith('['))
    return false

  const address = hostname.slice(1, -1).toLowerCase()
  if (address === '::1' || address === '::')
    return true
  if (/^f[cd][0-9a-f]{0,2}:/.test(address))
    return true
  if (/^fe[89ab][0-9a-f]?:/.test(address))
    return true
  // ::ffff:127.0.0.1 这种映射写法，拿后半段当 IPv4 再判一次
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address)
  if (mapped)
    return isBlockedIpv4(mapped[1])

  return false
}

/**
 * 校验 Bark 地址，返回 settings 命名空间下的文案键；合法时返回 null。
 * 空字符串交给调用方判断：总开关关着的时候允许留空。
 */
export function validateBarkBaseUrl(raw: string): string | null {
  const value = raw.trim()

  if (!value)
    return 'notify.urlError.required'

  if (value.length > NOTIFY_BARK_BASE_URL_MAX_LENGTH)
    return 'notify.urlError.tooLong'

  let parsed: URL
  try {
    parsed = new URL(value)
  }
  catch {
    return 'notify.urlError.malformed'
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol))
    return 'notify.urlError.protocol'

  const hostname = parsed.hostname.toLowerCase()

  if (!hostname)
    return 'notify.urlError.malformed'

  if (BLOCKED_HOSTNAMES.includes(hostname) || hostname.endsWith('.localhost'))
    return 'notify.urlError.private'

  if (isBlockedIpv4(hostname) || isBlockedIpv6(`[${hostname}]`) || isBlockedIpv6(hostname))
    return 'notify.urlError.private'

  return null
}

/** 校验分组：允许留空（留空时用默认分组），填了就不能超长 */
export function validateNotifyGroup(raw: string): string | null {
  const value = raw.trim()
  if (!value)
    return null
  if (value.length > NOTIFY_GROUP_MAX_LENGTH)
    return 'notify.groupError.tooLong'
  return null
}

/** 错误码 → settings 命名空间下的文案键。键名和 20600 段一一对应，不要凭印象加 */
const NOTIFY_ERROR_KEY_MAP: Record<number, string> = {
  [NOTIFY_ERROR_CODE.UrlInvalid]: 'notify.error.urlInvalid',
  [NOTIFY_ERROR_CODE.UrlBlocked]: 'notify.error.urlBlocked',
  [NOTIFY_ERROR_CODE.UrlUnresolvable]: 'notify.error.urlUnresolvable',
  [NOTIFY_ERROR_CODE.KeyRequired]: 'notify.error.keyRequired',
  [NOTIFY_ERROR_CODE.NotConfigured]: 'notify.error.notConfigured',
  [NOTIFY_ERROR_CODE.RuleInvalid]: 'notify.error.ruleInvalid',
  [NOTIFY_ERROR_CODE.GroupInvalid]: 'notify.error.groupInvalid',
}

/**
 * 把服务端错误码翻成 settings 命名空间下的文案键。
 * 认不出来的码返回 null，交给调用方退回服务端 message——服务端在 20600 段里加了新码，
 * 网页不会变成一句「未知错误」。
 */
export function getNotifyErrorKey(code?: string | number | null): string | null {
  if (code === undefined || code === null)
    return null

  const numeric = Number(code)
  if (Number.isNaN(numeric))
    return null

  return NOTIFY_ERROR_KEY_MAP[numeric] ?? null
}

/**
 * 测试失败原因 → settings 命名空间下的文案键。
 *
 * 契约要求「失败要说清楚是地址不对、key 不对、还是超时」，所以服务端给的每个原因码
 * 都得有自己的一句话，**不能一律落到「过一会儿再试」**。
 */
export function getNotifyTestFailKey(failure?: NotifyTestFailure | string | null): string {
  switch (failure) {
    case NotifyTestFailure.NotConfigured:
      return 'notify.testFail.notConfigured'
    case NotifyTestFailure.RuleDisabled:
      return 'notify.testFail.ruleDisabled'
    case NotifyTestFailure.UrlInvalid:
      return 'notify.testFail.urlInvalid'
    case NotifyTestFailure.UrlBlocked:
      return 'notify.testFail.urlBlocked'
    case NotifyTestFailure.UrlUnresolvable:
      return 'notify.testFail.urlUnresolvable'
    case NotifyTestFailure.Timeout:
      return 'notify.testFail.timeout'
    case NotifyTestFailure.Unreachable:
      return 'notify.testFail.unreachable'
    case NotifyTestFailure.Unauthorized:
      return 'notify.testFail.unauthorized'
    case NotifyTestFailure.Rejected:
      return 'notify.testFail.rejected'
    default:
      return 'notify.testFail.unknown'
  }
}

/**
 * 现在这条通知会走哪条通道。
 *
 * 和服务端 `NotifyService.resolveTarget` 的取配置顺序对齐（contract-settings 第五节）：
 * 1. **总开关关掉 → 彻底不推**，兜底通道也不走。只有存过配置的用户才有「关掉」这一说，
 *    所以用 `updatedAt` 区分「从没存过」和「存过但关掉了」——VO 明确写了没配过是 null。
 * 2. 总开关开着、地址和 key 都齐了 → 走用户自己的通道
 * 3. 否则服务器配了默认通道就走默认通道
 * 4. 都没有 → 静默跳过
 *
 * 「发送测试通知」能不能点就看这个：只靠默认通道的用户同样能测，不能因为他自己没填地址就把按钮灰掉。
 */
export type NotifyChannel = 'user' | 'env' | 'none'

export function resolveNotifyChannel(setting?: NotifySetting | null): NotifyChannel {
  if (!setting)
    return 'none'

  const everSaved = setting.updatedAt !== null
  if (everSaved && !setting.enabled)
    return 'none'

  if (setting.enabled && setting.barkBaseUrl && setting.barkKeyConfigured)
    return 'user'

  if (setting.envFallbackAvailable)
    return 'env'

  return 'none'
}
