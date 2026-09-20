import type { UserNotifySettingRepository } from '@yikart/mongodb'
/**
 * 「推送配置读谁的」这条链路（contract-settings 第五节）。
 *
 * 顺序必须是：用户自己配的 → `.env` 兜底 → 都没有就静默跳过。
 * 最后一条是阶段 4 的既有行为，改坏了就是线上所有没配推送的人开始收到报错。
 */
import { Logger } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { NotifyRuleType } from '@yikart/mongodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isNotifyRuleEnabled,
  mergeNotifySettings,
  NotifySettingsService,
  resolveEnvNotifySettings,
} from './notify-settings.service'

const { notifyConfig } = vi.hoisted(() => ({
  notifyConfig: {} as Record<string, unknown>,
}))

vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

const ENV_DEFAULTS = {
  enabled: true,
  barkUrl: 'https://env.example.com/env-device/',
  barkKey: 'env-header-key',
  group: 'AiToEarn',
}

const USER_DOC = {
  enabled: true,
  barkBaseUrl: 'https://user.example.com/user-device/',
  barkKey: 'user-header-key',
  group: '我的分组',
  rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }],
}

/** 仓储在这几个用例里只被当成一个 `getByUserId`，没必要把整个类搭出来 */
function stubRepo(getByUserId: ReturnType<typeof vi.fn>): UserNotifySettingRepository {
  return { getByUserId } as unknown as UserNotifySettingRepository
}

function setEnv(patch: Record<string, unknown> = {}) {
  for (const key of Object.keys(notifyConfig))
    delete notifyConfig[key]
  Object.assign(notifyConfig, ENV_DEFAULTS, patch)
}

describe('.env 兜底配置', () => {
  it.each([
    ['总开关关着', { enabled: false }],
    ['没填地址', { barkUrl: '' }],
    ['没填 key', { barkKey: '' }],
  ])('少一样就当没配：%s', (_, patch) => {
    expect(resolveEnvNotifySettings({ ...ENV_DEFAULTS, ...patch })).toBeNull()
  })

  it('整段配置都没有也不炸', () => {
    expect(resolveEnvNotifySettings(undefined)).toBeNull()
    expect(resolveEnvNotifySettings(null)).toBeNull()
  })

  it('配齐了就用它，来源标成 env', () => {
    expect(resolveEnvNotifySettings(ENV_DEFAULTS)).toEqual({
      barkUrl: ENV_DEFAULTS.barkUrl,
      barkKey: ENV_DEFAULTS.barkKey,
      group: 'AiToEarn',
      source: 'env',
      rules: [],
    })
  })
})

describe('用户配置和兜底怎么合', () => {
  const env = resolveEnvNotifySettings(ENV_DEFAULTS)

  it('用户配齐了就走用户自己的通道', () => {
    const merged = mergeNotifySettings(USER_DOC, env)

    expect(merged).toMatchObject({
      barkUrl: USER_DOC.barkBaseUrl,
      barkKey: USER_DOC.barkKey,
      group: '我的分组',
      source: 'user',
    })
  })

  it.each([
    ['地址没填', { barkBaseUrl: '' }],
    ['key 没填', { barkKey: '' }],
  ])('总开关开着但没填齐，退回 .env：%s', (_, patch) => {
    const merged = mergeNotifySettings({ ...USER_DOC, ...patch }, env)

    expect(merged).toMatchObject({ barkUrl: ENV_DEFAULTS.barkUrl, source: 'env' })
  })

  it('用户压根没有这条配置，也退回 .env', () => {
    expect(mergeNotifySettings(null, env)).toMatchObject({ source: 'env' })
  })

  it('两边都没有就是 null —— 静默跳过，阶段 4 的行为不变', () => {
    expect(mergeNotifySettings(null, null)).toBeNull()
    expect(mergeNotifySettings({ enabled: false }, null)).toBeNull()
  })

  /**
   * 契约第五节改过的那条：总开关关掉 → 彻底不推，不走任何通道。
   *
   * 初版按「用户没配**或没开**就退回 .env」实现，结果用户把开关关了还在收通知。
   */
  describe('总开关关掉就彻底不推', () => {
    it('.env 兜底配齐了也返回 null', () => {
      expect(mergeNotifySettings({ ...USER_DOC, enabled: false }, env)).toBeNull()
    })

    it('用户自己的地址填得好好的也返回 null：关掉不是「改用服务器的」', () => {
      expect(mergeNotifySettings(USER_DOC, env)).not.toBeNull()
      expect(mergeNotifySettings({ ...USER_DOC, enabled: false }, env)).toBeNull()
    })

    it('规则还开着也返回 null：规则是总开关之下的第二层筛子', () => {
      const merged = mergeNotifySettings(
        { ...USER_DOC, enabled: false, rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }] },
        env,
      )

      expect(merged).toBeNull()
    })
  })

  it('只是没填自己的地址、退回兜底通道时，用户配的规则依然算数', () => {
    const merged = mergeNotifySettings(
      { ...USER_DOC, barkBaseUrl: '', rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }] },
      env,
    )

    expect(merged?.source).toBe('env')
    expect(isNotifyRuleEnabled(merged!, NotifyRuleType.DRAFT_READY)).toBe(false)
  })
})

describe('规则开关', () => {
  const base = { barkUrl: 'https://x.example.com/d/', barkKey: 'k', group: 'AiToEarn', source: 'user' as const }

  it('规则关掉就是关掉', () => {
    const settings = { ...base, rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }] }

    expect(isNotifyRuleEnabled(settings, NotifyRuleType.DRAFT_READY)).toBe(false)
  })

  it('规则开着就是开着', () => {
    const settings = { ...base, rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }] }

    expect(isNotifyRuleEnabled(settings, NotifyRuleType.DRAFT_READY)).toBe(true)
  })

  it('规则数组里没有这一条，当作开着（老数据不会被悄悄停掉）', () => {
    expect(isNotifyRuleEnabled({ ...base, rules: [] }, NotifyRuleType.DRAFT_READY)).toBe(true)
  })
})

describe('notifySettingsService', () => {
  beforeEach(() => {
    setEnv()
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const user = { userId: 'u-1', userType: UserType.User }

  it('没接仓储（比如单测环境）就只走 .env', async () => {
    const settings = await new NotifySettingsService().resolve(user)

    expect(settings).toMatchObject({ source: 'env' })
  })

  it('不带用户就不查库，直接走 .env', async () => {
    const getByUserId = vi.fn()
    const repo = stubRepo(getByUserId)
    const settings = await new NotifySettingsService(repo).resolve()

    expect(getByUserId).not.toHaveBeenCalled()
    expect(settings).toMatchObject({ source: 'env' })
  })

  it('查到用户配置就用用户的', async () => {
    const getByUserId = vi.fn().mockResolvedValue(USER_DOC)
    const repo = stubRepo(getByUserId)
    const settings = await new NotifySettingsService(repo).resolve(user)

    expect(getByUserId).toHaveBeenCalledWith('u-1', UserType.User)
    expect(settings).toMatchObject({ barkUrl: USER_DOC.barkBaseUrl, source: 'user' })
  })

  it('查库炸了也不抛错，退回 .env —— 推送是旁支，不能把主流程带崩', async () => {
    const getByUserId = vi.fn().mockRejectedValue(new Error('connection refused'))
    const repo = stubRepo(getByUserId)
    const settings = await new NotifySettingsService(repo).resolve(user)

    expect(settings).toMatchObject({ source: 'env' })
  })

  it('查库炸了的那行日志里不带任何配置值', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const getByUserId = vi.fn().mockRejectedValue(new Error('mongodb://user:pass@10.0.0.1:27017'))
    const repo = stubRepo(getByUserId)

    await new NotifySettingsService(repo).resolve(user)

    const logged = warn.mock.calls.flat().map(arg => String(arg)).join(' ')
    expect(logged).not.toContain('10.0.0.1')
    expect(logged).not.toContain('pass')
  })

  it('用户配置和 .env 都没有，返回 null', async () => {
    setEnv({ enabled: false })
    const getByUserId = vi.fn().mockResolvedValue(null)
    const repo = stubRepo(getByUserId)

    await expect(new NotifySettingsService(repo).resolve(user)).resolves.toBeNull()
  })

  it('用户把总开关关了，就算 .env 兜底配齐了也返回 null', async () => {
    const getByUserId = vi.fn().mockResolvedValue({ ...USER_DOC, enabled: false })
    const repo = stubRepo(getByUserId)

    await expect(new NotifySettingsService(repo).resolve(user)).resolves.toBeNull()
  })
})
