import { createZodDto } from '@yikart/common'
import { NotifyRuleType } from '@yikart/mongodb'
import { z } from 'zod'

/** 掩码用的点，够长就行，不透露原值长度以外的东西 */
const MASK = '••••'

/**
 * 把密钥变成掩码。**只留后 4 位**（contract-settings 第四节）。
 *
 * 短到 4 位以内的干脆一个字符都不露：留后 4 位等于把整串都给出去了。
 */
export function maskNotifyKey(key: string): string {
  if (!key)
    return ''
  if (key.length <= 4)
    return MASK
  return `${MASK}${key.slice(-4)}`
}

const NotifyRuleVoSchema = z.object({
  type: z.enum(NotifyRuleType).describe('规则类型'),
  enabled: z.boolean().describe('这条规则开不开'),
})

const NotifySettingVoSchema = z.object({
  enabled: z.boolean().describe('推送总开关。关掉就一条都不推，服务器的默认通道也不走'),
  barkBaseUrl: z.string().describe('Bark 推送地址。地址本身不是密钥，原样返回'),
  barkKeyMask: z.string().describe('key 的掩码，形如 ••••abcd。没设置时是空串。**明文永远不回传**'),
  barkKeyConfigured: z.boolean().describe('是否已经设置过 key'),
  group: z.string().describe('通知分组'),
  rules: z.array(NotifyRuleVoSchema).describe('通知规则，一条规则一个对象'),
  envFallbackAvailable: z.boolean().describe(
    '服务器有没有配默认通道。有的话，用户只要没把总开关关掉，不填地址也能收到通知',
  ),
  updatedAt: z.coerce.date().nullable().describe('最后一次保存时间，没配过是 null'),
})
export class NotifySettingVo extends createZodDto(NotifySettingVoSchema, 'NotifySettingVo') {}

/** 测试通知的失败原因。**都是原因码，不含地址和 key**，网页侧自己翻成六种语言的文案 */
export const NOTIFY_TEST_FAILURES = [
  'not_configured',
  'rule_disabled',
  'url_invalid',
  'url_blocked',
  'url_unresolvable',
  'timeout',
  'unreachable',
  'unauthorized',
  'rejected',
] as const

const NotifyTestResultVoSchema = z.object({
  success: z.boolean().describe('发出去了没有'),
  failure: z.enum(NOTIFY_TEST_FAILURES).nullable().describe(
    '失败原因码：url_blocked 地址指向内网、url_unresolvable 域名解析不了、'
    + 'timeout 超时、unreachable 连不上、unauthorized key 不对、rejected 对端拒绝。'
    + 'not_configured / rule_disabled 不会从这里回，接口直接按业务错误码抛',
  ),
  status: z.number().nullable().describe('对端返回的 HTTP 状态码，没连上就是 null'),
})
export class NotifyTestResultVo extends createZodDto(NotifyTestResultVoSchema, 'NotifyTestResultVo') {}
