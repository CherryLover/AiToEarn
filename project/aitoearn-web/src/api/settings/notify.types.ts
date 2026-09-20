/**
 * 通知设置接口类型
 *
 * **字段名以服务端 VO 为准**（contract-settings 五点五节）。抄的是
 * `apps/aitoearn-server/src/core/settings/settings-notify.vo.ts`，
 * 一个字母都不要自己改——网页这边是手写声明，对不上 TypeScript 一句都不会报，
 * 只会在跑起来之后表现成「掩码永远不显示」「每次保存都被要求重输密钥」。
 * 服务端改了字段名，这里跟着改，别在组件里做兼容。
 *
 * 安全约定（contract-settings 第四节）：
 * 接口**永远不回传 barkKey 明文**，网页拿到的只有掩码和「已设置」标记。
 * 任何地方都不要把 barkBaseUrl / barkKey 写进 console、埋点或 URL。
 */

/**
 * 通知规则类型。
 * 这一轮只有一条，但服务端存的是数组，前端也按数组处理：以后加规则只加枚举值，不改结构。
 */
export enum NotifyRuleType {
  /** AI 生成素材结束后通知 */
  DraftReady = 'draft_ready',
}

/** 一条通知规则 */
export interface NotifyRule {
  type: NotifyRuleType
  enabled: boolean
}

/**
 * 通知设置读取结果，对应服务端 `NotifySettingVo`。
 * 用户没配过时服务端回默认值，`barkKeyConfigured` 为 false、`updatedAt` 为 null。
 */
export interface NotifySetting {
  /** 推送总开关。**关掉就彻底不推**，服务器的默认通道也不走 */
  enabled: boolean
  /** Bark 推送地址，形如 https://<域名>/<设备key>/。地址本身不是密钥，原样返回 */
  barkBaseUrl: string
  /** barkKey 的掩码，形如 ••••abcd；没设置时是空串。**只用来显示**，绝不能回填输入框再提交 */
  barkKeyMask: string
  /** key 是否已经设置过。false 时要开推送就必须现在填一个 */
  barkKeyConfigured: boolean
  /** 通知分组 */
  group: string
  /** 通知规则，顺序即展示顺序 */
  rules: NotifyRule[]
  /**
   * 服务器有没有配默认通道。
   * 有的话，用户自己不填地址也能收到通知——「发送测试通知」对这类用户是能用的，别把按钮灰掉。
   */
  envFallbackAvailable: boolean
  /** 最后一次保存时间，**没配过是 null**：用它区分「从没存过」和「存过但关掉了」 */
  updatedAt: string | null
}

/**
 * 保存通知设置请求参数，对应服务端 `UpdateNotifySettingDto`。
 *
 * `barkKey` 传空串表示「不改」——用户没动密钥框时**必须**传空串，
 * 不要拿掩码回填后再提交，那会把掩码存成真 key。
 */
export interface SaveNotifySettingParams {
  enabled: boolean
  barkBaseUrl: string
  barkKey: string
  group: string
  /** 不传表示这次不改规则；网页侧一直整份提交 */
  rules?: NotifyRule[]
}

/**
 * 测试通知的失败原因，对应服务端 `NOTIFY_TEST_FAILURES`。
 * 服务端只给原因码（**不含地址和 key**），网页翻成六种语言的人话。
 */
export enum NotifyTestFailure {
  /** 用户没配，服务器也没有默认通道 */
  NotConfigured = 'not_configured',
  /** 对应规则被用户关掉了 */
  RuleDisabled = 'rule_disabled',
  /** 地址不是合法 URL，或协议不是 http/https */
  UrlInvalid = 'url_invalid',
  /** 地址指向内网 / 回环 / 云元数据，不允许 */
  UrlBlocked = 'url_blocked',
  /** 域名解析不出来 */
  UrlUnresolvable = 'url_unresolvable',
  /** 超时 */
  Timeout = 'timeout',
  /** 连不上 */
  Unreachable = 'unreachable',
  /** 对端说 key 不对（401 / 403） */
  Unauthorized = 'unauthorized',
  /** 对端返回了别的非 2xx */
  Rejected = 'rejected',
}

/** 测试通知结果，对应服务端 `NotifyTestResultVo` */
export interface NotifyTestResult {
  /** 是否真的推出去了 */
  success: boolean
  /** 失败原因码；成功时是 null */
  failure: NotifyTestFailure | null
  /** 对端返回的 HTTP 状态码，没连上就是 null */
  status: number | null
}
