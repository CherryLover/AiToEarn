/**
 * AI 服务这边的推送实现是 aitoearn-server 那份的副本（两个应用没有共享的 lib）。
 * 这份用例只盯住三条硬要求，防止两份代码悄悄走偏：
 * 没配不发、发失败不影响主流程、内容被正确截断。
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_BODY_MAX, NOTIFY_TITLE_MAX } from './notify.format'
import { NotifyService } from './notify.service'

const { notifyConfig } = vi.hoisted(() => ({
  notifyConfig: {
    enabled: true,
    barkUrl: 'https://bark.example.com/device-key/',
    barkKey: 'header-key',
    group: 'AiToEarn',
  },
}))

vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

describe('bark 推送（AI 服务侧副本）', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    Object.assign(notifyConfig, {
      enabled: true,
      barkUrl: 'https://bark.example.com/device-key/',
      barkKey: 'header-key',
      group: 'AiToEarn',
    })

    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['总开关关着', { enabled: false }],
    ['没填地址', { barkUrl: '' }],
    ['没填 key', { barkKey: '' }],
  ])('没配就静默跳过：%s', async (_, patch) => {
    Object.assign(notifyConfig, patch)
    const notify = new NotifyService()

    expect(notify.enabled).toBe(false)
    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('发失败不抛错，主流程不受影响', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(new NotifyService().notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
  })

  it('标题 30 字、正文 100 字，草稿内容不会被原样投递', async () => {
    await new NotifyService().notifyDraftReady({
      projectName: 'fortyweeks',
      angle: 'pain-point',
      platform: 'xhs',
      draftTitle: '标'.repeat(300),
    })

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    const payload = JSON.parse(init.body as string) as { title: string, body: string }

    expect(Array.from(payload.title).length).toBeLessThanOrEqual(NOTIFY_TITLE_MAX)
    expect(Array.from(payload.body)).toHaveLength(NOTIFY_BODY_MAX)
    expect(payload.body.endsWith('…')).toBe(true)
  })
})
