import type { UpdateNotifySettingDto } from './settings-notify.dto'
import { Injectable } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import {
  cloneDefaultNotifyRules,
  DEFAULT_NOTIFY_RULES,
  NotifyRule,
  UserNotifySettingPatch,
  UserNotifySettingRepository,
} from '@yikart/mongodb'
import { NotifyUrlRejected, resolveAllowedUrl } from '../notify/notify-url.guard'
import { NotifyService } from '../notify/notify.service'
import { maskNotifyKey, NotifySettingVo, NotifyTestResultVo } from './settings-notify.vo'

@Injectable()
export class SettingsNotifyService {
  constructor(
    private readonly settingRepository: UserNotifySettingRepository,
    private readonly notifyService: NotifyService,
  ) {}

  /** 读配置。**barkKey 只回掩码**，明文一次都不出这个进程 */
  async get(userId: string, userType: UserType = UserType.User): Promise<NotifySettingVo> {
    const setting = await this.settingRepository.getByUserId(userId, userType)

    return NotifySettingVo.create({
      enabled: setting?.enabled ?? false,
      barkBaseUrl: setting?.barkBaseUrl ?? '',
      barkKeyMask: maskNotifyKey(setting?.barkKey ?? ''),
      barkKeyConfigured: Boolean(setting?.barkKey),
      group: setting?.group || 'AiToEarn',
      rules: normalizeRules(setting?.rules),
      envFallbackAvailable: this.notifyService.enabled,
      updatedAt: setting?.updatedAt ?? null,
    })
  }

  /**
   * 保存配置。
   *
   * 两件事必须在这里做掉，不能留到发送时才发现：
   * 1. 地址过一遍 SSRF 校验，不合格当场拒，并且给人话提示
   * 2. `barkKey` 空串表示「不改」，不能把用户已经存好的那个冲掉
   */
  async save(
    userId: string,
    userType: UserType,
    dto: UpdateNotifySettingDto,
  ): Promise<NotifySettingVo> {
    const existing = await this.settingRepository.getByUserId(userId, userType)

    const rules = dto.rules === undefined ? undefined : assertRules(dto.rules)
    const group = dto.group.trim() || 'AiToEarn'
    const baseUrl = dto.barkBaseUrl.trim()

    const patch: UserNotifySettingPatch = {
      enabled: dto.enabled,
      barkBaseUrl: baseUrl,
      group,
      ...(rules === undefined ? {} : { rules }),
    }

    if (!baseUrl) {
      // 地址清空 = 不再用自己的通道。顺手把密钥也删掉，
      // 不留一个既用不上、又没有入口能删的明文凭据在库里
      patch.barkKey = ''
    }
    else {
      // 空串表示不改，落到库里的是原来那个
      const key = dto.barkKey || existing?.barkKey || ''
      if (!key)
        throw new AppException(ResponseCode.SettingsNotifyKeyRequired)

      await assertUrlAllowed(baseUrl)

      if (dto.barkKey)
        patch.barkKey = dto.barkKey
    }

    await this.settingRepository.upsertByUserId(userId, userType, patch)

    return await this.get(userId, userType)
  }

  /**
   * 用当前保存的配置真发一条测试通知。
   *
   * 走的是和正常推送完全一样的链路（同样的 SSRF 校验、同样的截断、同样的超时），
   * 只是把失败原因带回来给人看。
   */
  async sendTest(userId: string, userType: UserType = UserType.User): Promise<NotifyTestResultVo> {
    const result = await this.notifyService.sendTest({ userId, userType })

    // 总开关关着时推送链路返回的也是 not_configured（关掉 = 一条都不推，测试也不例外），
    // 这时报「还没配好通知，先保存再发测试」比真发一条更诚实：真发了用户会以为推送在工作
    if (result.failure === 'not_configured')
      throw new AppException(ResponseCode.SettingsNotifyNotConfigured)

    return NotifyTestResultVo.create({
      success: result.success,
      failure: result.failure ?? null,
      status: result.status ?? null,
    })
  }
}

/** 没配过的时候给一份默认规则，网页上直接就能看到开关，不用先保存一次 */
function normalizeRules(rules?: NotifyRule[]): NotifyRule[] {
  if (!rules?.length)
    return cloneDefaultNotifyRules()

  // 库里可能少了新加的规则类型（老数据），补齐再回
  const merged = new Map<string, NotifyRule>()
  for (const fallback of DEFAULT_NOTIFY_RULES)
    merged.set(fallback.type, { ...fallback })
  for (const rule of rules)
    merged.set(rule.type, { type: rule.type, enabled: rule.enabled })

  return [...merged.values()]
}

/** 同一种规则只能给一条，给两条说不清以哪条为准 */
function assertRules(rules: NotifyRule[]): NotifyRule[] {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.type))
      throw new AppException(ResponseCode.SettingsNotifyRuleInvalid)
    seen.add(rule.type)
  }
  return rules.map(rule => ({ type: rule.type, enabled: rule.enabled }))
}

/**
 * 地址校验。**拒绝时给人话提示，说清楚是地址不允许**，但提示里一个字都不带原地址。
 */
async function assertUrlAllowed(rawUrl: string): Promise<void> {
  try {
    await resolveAllowedUrl(rawUrl)
  }
  catch (error) {
    if (error instanceof NotifyUrlRejected) {
      if (error.rejection === 'blocked')
        throw new AppException(ResponseCode.SettingsNotifyUrlBlocked)
      if (error.rejection === 'unresolvable')
        throw new AppException(ResponseCode.SettingsNotifyUrlUnresolvable)
      throw new AppException(ResponseCode.SettingsNotifyUrlInvalid)
    }
    throw error
  }
}
