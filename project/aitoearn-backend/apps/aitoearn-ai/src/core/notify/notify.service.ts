import type { DraftReadyInput, ManualPublishInput, NotifyMessage } from './notify.format'
import { Injectable, Logger } from '@nestjs/common'
import { config } from '../../config'
import {
  draftReadyMessage,
  manualPublishMessage,
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  truncateText,
} from './notify.format'

/** 一次推送最多等 5 秒。推送是旁支，不能让它把主流程的请求挂住 */
export const NOTIFY_TIMEOUT_MS = 5000

/**
 * Bark 推送。
 *
 * 三条硬规矩（contract-stage4 第二节）：
 * 1. **失败绝不影响主流程**：本服务的方法一个都不抛错，失败只记一行日志
 * 2. **没配就静默跳过**：不抛错、不刷日志
 * 3. **不把用户内容原样塞进推送**：标题 30 字、正文 100 字，超了截断
 *
 * 这份实现在 `apps/aitoearn-server/src/core/notify/notify.service.ts` 有一份副本（两个应用都要推），
 * 改动时必须同步。
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name)

  private get settings() {
    return config.notify
  }

  /** 配齐了才算开：总开关、地址、key 少一样都当没配 */
  get enabled(): boolean {
    const settings = this.settings
    return Boolean(settings?.enabled && settings.barkUrl && settings.barkKey)
  }

  /**
   * 发一条推送。**永远不抛错**。
   * 返回值只给测试和日志看，业务代码不用管发没发出去。
   */
  async send(message: NotifyMessage): Promise<boolean> {
    const settings = this.settings
    if (!this.enabled)
      return false

    const payload = {
      title: truncateText(message.title, NOTIFY_TITLE_MAX),
      body: truncateText(message.body, NOTIFY_BODY_MAX),
      group: settings.group,
    }

    try {
      const response = await fetch(settings.barkUrl, {
        method: 'POST',
        headers: {
          'bark-key': settings.barkKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      })

      if (!response.ok) {
        this.logger.warn(`Bark 推送被拒绝：HTTP ${response.status}`)
        return false
      }

      return true
    }
    catch (error) {
      // 超时、DNS、证书、对端挂了……一律咽掉，主流程不受任何影响
      this.logger.warn(error, 'Bark 推送失败')
      return false
    }
  }

  /** AI 生成草稿完成 */
  async notifyDraftReady(input: DraftReadyInput): Promise<boolean> {
    return await this.send(draftReadyMessage(input))
  }

  /** 有一条 manual 发布工单等着人工去发 */
  async notifyManualPublishPending(input: ManualPublishInput): Promise<boolean> {
    return await this.send(manualPublishMessage(input))
  }
}
