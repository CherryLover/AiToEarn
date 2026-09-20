/**
 * AI 服务这边的推送实现是 aitoearn-server 那份的副本（两个应用没有共享的 lib）。
 * 这份用例盯住阶段 4 的三条硬要求 —— 没配不发、发失败不影响主流程、内容被正确截断 ——
 * 外加阶段 5 新增的两条：读用户自己配的地址、规则关掉就不发。
 */
import type { NotifySettingsService } from './notify-settings.service'
import { Logger } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { NotifyRuleType } from '@yikart/mongodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_BODY_MAX, NOTIFY_TITLE_MAX } from './notify.format'
import { NotifyService } from './notify.service'

const { notifyConfig, postMock } = vi.hoisted(() => ({
  notifyConfig: {
    enabled: true,
    barkUrl: 'https://env.example.com/env-device/',
    barkKey: 'env-header-key',
    group: 'AiToEarn',
  },
  postMock: vi.fn(),
}))

vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

// 真正发包那一层（含 SSRF 校验）由 notify.ssrf.spec.ts 自己盯，这里只关心「发了什么、发没发」
vi.mock('./notify.ssrf', async importOriginal => ({
  ...await importOriginal<typeof import('./notify.ssrf')>(),
  postNotifyRequest: postMock,
}))

const USER = { userId: 'u-1', userType: UserType.User }

/** 把配置服务桩成「就返回这一组值」，省得为了一条推送把整个仓储搭出来 */
function stubSettings(resolve: ReturnType<typeof vi.fn>): NotifySettingsService {
  return { resolve } as unknown as NotifySettingsService
}

const USER_SETTINGS = {
  barkUrl: 'https://user.example.com/user-device/',
  barkKey: 'user-header-key',
  group: '我的分组',
  source: 'user' as const,
  rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }],
}

describe('bark 推送（AI 服务侧副本）', () => {
  beforeEach(() => {
    Object.assign(notifyConfig, {
      enabled: true,
      barkUrl: 'https://env.example.com/env-device/',
      barkKey: 'env-header-key',
      group: 'AiToEarn',
    })

    postMock.mockReset()
    postMock.mockResolvedValue(200)
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['总开关关着', { enabled: false }],
    ['没填地址', { barkUrl: '' }],
    ['没填 key', { barkKey: '' }],
  ])('两边都没配就静默跳过：%s', async (_, patch) => {
    Object.assign(notifyConfig, patch)
    const notify = new NotifyService()

    expect(notify.enabled).toBe(false)
    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('发失败不抛错，主流程不受影响', async () => {
    postMock.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.3:443'))

    await expect(new NotifyService().notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
  })

  it('发失败那行日志里不带地址、不带 key', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    postMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.3:443'))

    await new NotifyService().notifyDraftReady({ projectName: 'fortyweeks' })

    const logged = warn.mock.calls.flat().map(arg => String(arg)).join(' ')
    expect(logged).not.toContain('10.0.0.3')
    expect(logged).not.toContain('env.example.com')
    expect(logged).not.toContain('env-header-key')
  })

  it('标题 30 字、正文 100 字，草稿内容不会被原样投递', async () => {
    await new NotifyService().notifyDraftReady({
      projectName: 'fortyweeks',
      angle: 'pain-point',
      platform: 'xhs',
      draftTitle: '标'.repeat(300),
    })

    const [, init] = postMock.mock.calls.at(-1) as [string, { body: string }]
    const payload = JSON.parse(init.body) as { title: string, body: string }

    expect(Array.from(payload.title).length).toBeLessThanOrEqual(NOTIFY_TITLE_MAX)
    expect(Array.from(payload.body)).toHaveLength(NOTIFY_BODY_MAX)
    expect(payload.body.endsWith('…')).toBe(true)
  })

  it('用户配了自己的通道就用他的地址、key 和分组，并且走 SSRF 校验', async () => {
    const notify = new NotifyService(stubSettings(vi.fn().mockResolvedValue(USER_SETTINGS)))

    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, USER)).resolves.toBe(true)

    const [url, init] = postMock.mock.calls.at(-1) as [string, { headers: Record<string, string>, body: string, allowPrivateAddress?: boolean }]
    expect(url).toBe(USER_SETTINGS.barkUrl)
    expect(init.headers['bark-key']).toBe(USER_SETTINGS.barkKey)
    expect(JSON.parse(init.body).group).toBe('我的分组')
    // 用户填的地址不许放行内网
    expect(init.allowPrivateAddress).toBe(false)
  })

  it('.env 兜底通道放行内网：运维可能自建了一个内网的 Bark', async () => {
    await new NotifyService().notifyDraftReady({ projectName: 'fortyweeks' })

    const [, init] = postMock.mock.calls.at(-1) as [string, { allowPrivateAddress?: boolean }]
    expect(init.allowPrivateAddress).toBe(true)
  })

  it('用户把总开关关了：一条都不推，.env 兜底通道也不走', async () => {
    // resolve 返回 null 就是「总开关关掉」在这一层的样子，判断本身在 mergeNotifySettings 里
    const notify = new NotifyService(stubSettings(vi.fn().mockResolvedValue(null)))

    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, USER)).resolves.toBe(false)
    await expect(notify.notifyManualPublishPending({ platform: 'xhs' }, USER)).resolves.toBe(false)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('draft_ready 这条规则关掉，生成完就不推', async () => {
    const settings = {
      ...USER_SETTINGS,
      rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }],
    }
    const notify = new NotifyService(stubSettings(vi.fn().mockResolvedValue(settings)))

    await expect(notify.canNotify(NotifyRuleType.DRAFT_READY, USER)).resolves.toBe(false)
    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, USER)).resolves.toBe(false)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('规则开着就正常推', async () => {
    const notify = new NotifyService(stubSettings(vi.fn().mockResolvedValue(USER_SETTINGS)))

    await expect(notify.canNotify(NotifyRuleType.DRAFT_READY, USER)).resolves.toBe(true)
    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, USER)).resolves.toBe(true)
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('两边都没配时 canNotify 也是 false，调用方不用白扫一遍草稿目录', async () => {
    const notify = new NotifyService(stubSettings(vi.fn().mockResolvedValue(null)))

    await expect(notify.canNotify(NotifyRuleType.DRAFT_READY, USER)).resolves.toBe(false)
  })
})
