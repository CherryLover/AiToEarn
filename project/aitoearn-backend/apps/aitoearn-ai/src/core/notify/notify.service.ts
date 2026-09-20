import type { NotifyUserRef, ResolvedNotifySettings } from './notify-settings.service'
import type { DraftReadyInput, ManualPublishInput, NotifyMessage } from './notify.format'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { config } from '../../config'
import { isNotifyRuleEnabled, NotifyRuleType, NotifySettingsService, resolveEnvNotifySettings } from './notify-settings.service'
import {
  draftReadyMessage,
  manualPublishMessage,
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  truncateText,
} from './notify.format'
import { describeNotifyFailure, postNotifyRequest } from './notify.ssrf'

export { NOTIFY_TIMEOUT_MS } from './notify.ssrf'

export interface NotifySendOptions {
  /** 推给谁。带上才会去查这个人自己配的 Bark 地址和规则开关 */
  user?: NotifyUserRef
  /** 这条推送归哪条规则管。规则被用户关掉时直接不发 */
  rule?: NotifyRuleType
}

/**
 * Bark 推送。
 *
 * 三条硬规矩（contract-stage4 第二节，阶段 5 沿用）：
 * 1. **失败绝不影响主流程**：本服务的方法一个都不抛错，失败只记一行日志
 * 2. **没配就静默跳过**：不抛错、不刷日志
 * 3. **不把用户内容原样塞进推送**：标题 30 字、正文 100 字，超了截断
 *
 * 阶段 5 加的两条（contract-settings 第五节）：
 * 4. **总开关关掉就彻底不推**；开着但地址没填齐退回 `.env`；都没有才静默跳过
 * 5. **规则开关要生效**：`draft_ready` 关掉时，生成完不推（这是总开关之下的第二层筛子）
 *
 * 还有一条贯穿全文件的：**地址和 key 一个字都不许进日志**。
 * 失败原因只用 `notify.ssrf.ts` 里那组固定枚举表示，底层 error 一律不透出。
 *
 * 这份实现在 `apps/aitoearn-server/src/core/notify/notify.service.ts` 有一份副本（两个应用都要推），
 * 改动时必须同步。
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name)

  constructor(
    @Optional() private readonly settingsService?: NotifySettingsService,
  ) {}

  private async resolveSettings(user?: NotifyUserRef): Promise<ResolvedNotifySettings | null> {
    if (this.settingsService)
      return await this.settingsService.resolve(user)
    // 没接上配置服务（单元测试、或者模块装配出岔子）时退回 .env，行为和阶段 4 一样
    return resolveEnvNotifySettings(config.notify)
  }

  /**
   * `.env` 兜底通道配齐了没有。
   *
   * 留着是为了不动别处的调用；判「这一条到底推不推得出去」请用 {@link canNotify}，
   * 因为用户可能只配了自己的通道、或者把某条规则关掉了，这两种情况这个 getter 都答不上来。
   */
  get enabled(): boolean {
    return resolveEnvNotifySettings(config.notify) !== null
  }

  /**
   * 这个用户的这条规则现在推不推得出去（凭据 + 规则开关一起算）。
   *
   * 给调用方做前置判断用：推送前要干的重活（比如扫草稿目录）可以先问一句，省掉白干。
   */
  async canNotify(rule: NotifyRuleType, user?: NotifyUserRef): Promise<boolean> {
    try {
      const settings = await this.resolveSettings(user)
      return settings !== null && isNotifyRuleEnabled(settings, rule)
    }
    catch (error) {
      // 不把 error 本身交给 logger：底层异常的文本里会带主机名和 IP，等于把用户的推送地址打进日志
      this.logger.warn(`读取推送配置失败（${describeNotifyFailure(error)}）`)
      return false
    }
  }

  /**
   * 发一条推送。**永远不抛错**。
   * 返回值只给测试和日志看，业务代码不用管发没发出去。
   */
  async send(message: NotifyMessage, options?: NotifySendOptions): Promise<boolean> {
    try {
      const settings = await this.resolveSettings(options?.user)
      if (!settings)
        return false

      if (options?.rule && !isNotifyRuleEnabled(settings, options.rule))
        return false

      await postNotifyRequest(settings.barkUrl, {
        headers: {
          'bark-key': settings.barkKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: truncateText(message.title, NOTIFY_TITLE_MAX),
          body: truncateText(message.body, NOTIFY_BODY_MAX),
          group: settings.group,
        }),
        // 用户填的地址过 SSRF 校验；.env 里那个是运维自己填的，可能就是内网自建的 Bark
        allowPrivateAddress: settings.source === 'env',
      })

      return true
    }
    catch (error) {
      // 超时、DNS、证书、地址被拒、对端挂了……一律咽掉，主流程不受任何影响。
      // 这里**故意不按仓库惯例把 error 作为第一个参数传给 logger**：底层异常的文本里
      // 常常带着主机名和 IP（`connect ECONNREFUSED 10.0.0.3:443`），打出去就把用户的
      // 推送地址泄露了。只输出 describeNotifyFailure 收敛出来的固定分类
      this.logger.warn(`Bark 推送失败（${describeNotifyFailure(error)}）`)
      return false
    }
  }

  /** AI 生成草稿完成 */
  async notifyDraftReady(input: DraftReadyInput, user?: NotifyUserRef): Promise<boolean> {
    return await this.send(draftReadyMessage(input), { user, rule: NotifyRuleType.DRAFT_READY })
  }

  /** 有一条 manual 发布工单等着人工去发 */
  async notifyManualPublishPending(input: ManualPublishInput, user?: NotifyUserRef): Promise<boolean> {
    return await this.send(manualPublishMessage(input), { user })
  }
}
