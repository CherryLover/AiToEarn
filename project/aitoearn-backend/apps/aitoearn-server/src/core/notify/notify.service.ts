import type { LeanDoc } from '@yikart/mongodb'
import type { DraftReadyInput, ManualPublishInput, NotifyMessage } from './notify.format'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { NotifyRuleType, UserNotifySetting, UserNotifySettingRepository } from '@yikart/mongodb'
import { config } from '../../config'
import { NotifyUrlRejected } from './notify-url.guard'
import {
  draftReadyMessage,
  manualPublishMessage,
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  truncateText,
} from './notify.format'
import { NOTIFY_TIMEOUT_MS, NotifyTransportError, postGuardedJson } from './notify.http'

export { NOTIFY_TIMEOUT_MS }

/** 一条推送要发给谁、归哪条规则管 */
export interface NotifyContext {
  /** 推给哪个用户。不传就只走 `.env` 的默认通道（和阶段 4 的行为完全一致） */
  userId?: string
  userType?: UserType
  /** 这条推送归哪条规则管。用户把规则关了就不推 */
  rule?: NotifyRuleType
}

/**
 * 推送没发出去的原因。
 *
 * 这些值会写进日志、也会回给网页的「发送测试通知」，**所以一个字都不能带地址和 key**。
 */
export type NotifyFailure
  // 没有可用的通道：用户把总开关关了，或者用户没配、`.env` 也没配
  = | 'not_configured'
    | 'rule_disabled' // 用户把这条规则关了
    | 'url_invalid' // 地址不是合法 URL，或协议不是 http/https
    | 'url_blocked' // 地址指向内网 / 回环 / 云元数据
    | 'url_unresolvable' // 域名解析不出来
    | 'timeout' // 超时
    | 'unreachable' // 连不上
    | 'unauthorized' // 对端说 key 不对（401 / 403）
    | 'rejected' // 对端返回了别的非 2xx

export interface NotifyResult {
  success: boolean
  failure?: NotifyFailure
  /** 对端的 HTTP 状态码，只有真发出去了才有 */
  status?: number
}

/** 真正要用的那套配置 */
interface NotifyTarget {
  baseUrl: string
  key: string
  group: string
  /**
   * 配置从哪来。**两种来源走的是同一套带防护的发包实现**（`postGuardedJson`），
   * 区别只在要不要放行内网地址：
   *
   * - `user`：用户在网页上填的，内网一律拒
   * - `env`：服务器 `.env` 渲染进来的，运维自己配的，**只放行 `.env` 里那个地址本身，任何一跳跳转都不放行**
   *   （线上就有把 Bark 装在同机、写成 `http://127.0.0.1:.../` 的用法，一刀切拦掉会把既有部署打死；
   *   但跟着对端给的 302 再往哪打，运维从来没同意过，同主机名也一样——见 `notify.http.ts` 的说明）
   */
  source: 'user' | 'env'
}

type NotifySettingDoc = LeanDoc<UserNotifySetting>

/**
 * Bark 推送。
 *
 * 三条硬规矩（contract-stage4 第二节，contract-settings 第五节沿用）：
 * 1. **失败绝不影响主流程**：本服务的方法一个都不抛错，失败只记一行日志
 * 2. **没配就静默跳过**：不抛错、不刷日志
 * 3. **不把用户内容原样塞进推送**：标题 30 字、正文 100 字，超了截断
 *
 * 外加一条这一轮的：**地址和 key 任何时候都不进日志、不进返回值**。
 *
 * 取配置的顺序（contract-settings 第五节，**这一版是改过的，别照老印象读**）：
 * 1. **总开关 `enabled` 关掉 → 彻底不推**，`.env` 兜底通道也不走
 * 2. 总开关开着但用户没填地址 → 退回 `.env`
 * 3. 都没有 → 静默跳过
 *
 * 第 1 条是踩过坑才写死的：初版按「用户没配**或没开**就退回 .env」实现，
 * 结果用户把总开关关了还在继续收通知。规则开关是总开关之下的第二层筛子，不是替代品。
 *
 * 这份实现在 `apps/aitoearn-ai/src/core/notify/notify.service.ts` 有一份副本（两个应用都要推），
 * 那边的取配置逻辑在 `notify-settings.service.ts` 的 `mergeNotifySettings`，改动时必须同步。
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name)

  constructor(
    // @Optional：单测里直接 `new NotifyService()` 就能跑；没有数据库时退回 `.env` 兜底
    @Optional() private readonly settingRepository?: UserNotifySettingRepository,
  ) {}

  private get envSettings() {
    return config.notify
  }

  /** `.env` 那套兜底通道配齐了没有。配齐了才算开：总开关、地址、key 少一样都当没配 */
  get enabled(): boolean {
    const settings = this.envSettings
    return Boolean(settings?.enabled && settings.barkUrl && settings.barkKey)
  }

  /**
   * 发一条推送。**永远不抛错**。
   * 返回值只给测试和日志看，业务代码不用管发没发出去。
   */
  async send(message: NotifyMessage, context?: NotifyContext): Promise<boolean> {
    const result = await this.deliver(message, context)
    return result.success
  }

  /**
   * 发一条推送并把失败原因带回来。设置页的「发送测试通知」用这个。
   * 和 `send` 走的是同一条链路，不是另开一套。
   */
  async deliver(message: NotifyMessage, context?: NotifyContext): Promise<NotifyResult> {
    const resolved = await this.resolveTarget(context)
    if (!resolved.target)
      return { success: false, failure: resolved.failure }

    const target = resolved.target
    const payload = {
      title: truncateText(message.title, NOTIFY_TITLE_MAX),
      body: truncateText(message.body, NOTIFY_BODY_MAX),
      group: target.group,
    }

    const result = await this.post(target, payload)

    if (!result.success) {
      // 只记原因码。原始错误里可能带着地址（ECONNREFUSED 1.2.3.4:443），绝不能进日志
      this.logger.warn(`Bark 推送失败：${result.failure}${result.status ? ` (HTTP ${result.status})` : ''}`)
    }

    return result
  }

  /** AI 生成草稿完成。归 `draft_ready` 规则管 */
  async notifyDraftReady(input: DraftReadyInput, context?: NotifyContext): Promise<boolean> {
    return await this.send(draftReadyMessage(input), { ...context, rule: NotifyRuleType.DRAFT_READY })
  }

  /** 有一条 manual 发布工单等着人工去发 */
  async notifyManualPublishPending(input: ManualPublishInput, context?: NotifyContext): Promise<boolean> {
    return await this.send(manualPublishMessage(input), context)
  }

  /** 设置页的「发送测试通知」。标题写明是测试，免得收到的人以为真出了内容 */
  async sendTest(context: NotifyContext): Promise<NotifyResult> {
    return await this.deliver(
      {
        title: '🔔 AiToEarn 测试通知',
        body: '这是设置页发出的测试通知。收到就说明推送配好了。',
      },
      context,
    )
  }

  /**
   * 取配置（contract-settings 第五节）：
   * 总开关关掉 → 什么都不推；总开关开着但没填地址 → 退回 `.env`；都没有 → 静默跳过。
   *
   * 两层筛子的顺序是定死的：**先看总开关，再看规则**。
   * 用户只有一条配置时这两层看着差不多，但总开关关掉是「一条都别推」，
   * 规则关掉只是「这一类别推」——别把它们合成一个判断。
   */
  private async resolveTarget(context?: NotifyContext): Promise<{ target?: NotifyTarget, failure?: NotifyFailure }> {
    const setting = await this.loadSetting(context?.userId, context?.userType)

    // 总开关关掉 = 这个人不想收通知，连运维配的兜底通道也不许替他做主
    if (setting && !setting.enabled)
      return { failure: 'not_configured' }

    if (setting && context?.rule && !isRuleEnabled(setting, context.rule))
      return { failure: 'rule_disabled' }

    if (setting?.enabled && setting.barkBaseUrl && setting.barkKey) {
      return {
        target: {
          baseUrl: setting.barkBaseUrl,
          key: setting.barkKey,
          group: setting.group || 'AiToEarn',
          source: 'user',
        },
      }
    }

    const env = this.envSettings
    if (env?.enabled && env.barkUrl && env.barkKey) {
      return {
        target: {
          baseUrl: env.barkUrl,
          key: env.barkKey,
          group: env.group || 'AiToEarn',
          source: 'env',
        },
      }
    }

    return { failure: 'not_configured' }
  }

  /** 读用户配置。读不到就当没配——数据库抖一下不该让主流程感知到 */
  private async loadSetting(userId?: string, userType?: UserType): Promise<NotifySettingDoc | null> {
    if (!userId || !this.settingRepository)
      return null

    try {
      return await this.settingRepository.getByUserId(userId, userType ?? UserType.User)
    }
    catch {
      return null
    }
  }

  /**
   * 真正发出去这一步。**用户配的和 `.env` 兜底走的是同一个实现**：
   * 每一跳都过 SSRF 校验、用校验过的 IP 连、超时和响应体上限都一样。
   *
   * 唯一的区别是 `allowPrivateAddress`：`.env` 那条允许**初始地址**落在内网
   * （运维可能把 Bark 装在同机），但**只要跟了 302，下一跳就重新按严格规则判，同主机名也不例外**。
   * 不能因为地址是运维配的就整条链路免检——明文 http、域名过期被抢注、链路被劫持，
   * 都能让那个端点回一个 302 把请求（连同 `bark-key` 头）带去内网。
   */
  private async post(target: NotifyTarget, payload: object): Promise<NotifyResult> {
    try {
      const response = await postGuardedJson(
        target.baseUrl,
        { 'bark-key': target.key, 'content-type': 'application/json' },
        JSON.stringify(payload),
        {
          timeoutMs: NOTIFY_TIMEOUT_MS,
          allowPrivateAddress: target.source === 'env',
        },
      )
      return classifyStatus(response.status)
    }
    catch (error) {
      // 超时、DNS、证书、地址被拒、对端挂了……一律咽掉，主流程不受任何影响
      return { success: false, failure: classifyError(error) }
    }
  }
}

/** 规则没在库里出现时当作开着：和阶段 4 的行为一致，不会因为漏了一条规则就不推 */
export function isRuleEnabled(setting: NotifySettingDoc, rule: NotifyRuleType): boolean {
  const hit = setting.rules?.find(item => item.type === rule)
  return hit ? hit.enabled : true
}

function classifyStatus(status: number): NotifyResult {
  if (status >= 200 && status < 300)
    return { success: true, status }

  if (status === 401 || status === 403)
    return { success: false, failure: 'unauthorized', status }

  return { success: false, failure: 'rejected', status }
}

/** 把各路错误翻成原因码。**只看类型，不看 message**，message 里可能带地址 */
function classifyError(error: unknown): NotifyFailure {
  if (error instanceof NotifyUrlRejected) {
    if (error.rejection === 'blocked')
      return 'url_blocked'
    if (error.rejection === 'unresolvable')
      return 'url_unresolvable'
    return 'url_invalid'
  }

  if (error instanceof NotifyTransportError)
    return error.failure === 'timeout' ? 'timeout' : 'unreachable'

  const name = (error as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError')
    return 'timeout'

  return 'unreachable'
}
