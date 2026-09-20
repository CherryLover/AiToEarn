/**
 * 通知设置接口常量
 * 与服务端契约保持一致：默认分组、长度上限、业务错误码。
 *
 * **长度上限抄 `settings-notify.dto.ts`，错误码抄 `response-code.enum.ts`**
 * （contract-settings 五点五节）。凭印象编号的后果是：域名解析不出来时提示
 * 「填了地址就得填 key」，key 没填时提示「分组不合法」。
 */

import { NotifyRuleType } from './notify.types'

/** 通知分组默认值，跟服务端 `.env` 兜底值一致 */
export const NOTIFY_GROUP_DEFAULT = 'AiToEarn'

/** Bark 地址最长长度，跟服务端 DTO 的 `barkBaseUrl.max(500)` 一致 */
export const NOTIFY_BARK_BASE_URL_MAX_LENGTH = 500

/** Bark key 最长长度，跟服务端 DTO 的 `barkKey.max(200)` 一致 */
export const NOTIFY_BARK_KEY_MAX_LENGTH = 200

/** 通知分组最长长度，跟服务端 DTO 的 `group.max(50)` 一致 */
export const NOTIFY_GROUP_MAX_LENGTH = 50

/**
 * 规则展示顺序。
 * 这一轮只有一条，但设置页按数组渲染成列表，加规则时只往这里追加，不改组件。
 */
export const NOTIFY_RULE_ORDER = [NotifyRuleType.DraftReady] as const

/**
 * 通知相关业务错误码，**逐个对应**服务端 `ResponseCode` 的 20600 段。
 * 加码、改码都以 `libs/common/src/enums/response-code.enum.ts` 为准。
 *
 * 网页侧的兜底策略：命中下表就用本地文案，没命中就直接显示服务端返回的 message，
 * 两者都没有才落到本地的「保存失败」。所以服务端若在 20600 段里加码，网页不会哑掉。
 */
export const NOTIFY_ERROR_CODE = {
  /** 20600 通知地址不合法：不是合法 URL，或协议不是 http/https */
  UrlInvalid: 20600,
  /** 20601 通知地址指向内网、回环或云元数据地址，不允许 */
  UrlBlocked: 20601,
  /** 20602 通知地址的域名解析不出来 */
  UrlUnresolvable: 20602,
  /** 20603 填了地址就得填 key */
  KeyRequired: 20603,
  /** 20604 还没配通知，先保存再测试 */
  NotConfigured: 20604,
  /** 20605 通知规则不合法：类型不认识或同一类型给了多条 */
  RuleInvalid: 20605,
  /** 20606 通知分组不合法 */
  GroupInvalid: 20606,
} as const
