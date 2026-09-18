/**
 * AI 服务这边的推送配置是 aitoearn-server 那份的副本（两个应用没有共享的 lib）。
 * 这份用例盯的是「把 Bark 配置清空，服务照常起」——两个容器读的是各自渲染出来的配置，
 * 谁的 schema 收紧了都会让那个容器起不来，所以两边各锁一份。
 *
 * 完整背景、渲染规则和复现命令见 `apps/aitoearn-server/src/core/notify/notify.config.spec.ts`。
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyConfigSchema } from './notify.config'
import { NotifyService } from './notify.service'

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

describe('bark 配置清空后 AI 服务照常', () => {
  beforeEach(() => {
    for (const key of Object.keys(notifyConfig))
      delete notifyConfig[key]
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // 都是真的跑 deploy/oci/render_config.py 渲染 overrides/ai.yaml 得到的 notify 段
  it.each([
    ['四个变量都留空', {}],
    ['照 .env.example 只留了分组', { group: 'AiToEarn' }],
    ['开关开了但地址和 key 忘了填', { enabled: true, group: 'AiToEarn' }],
    ['整段 notify 都不在配置里', undefined],
    // README「下次重启窗口实跑一次」那一步产生的形态：只清总开关，地址和 key 还在
    ['只清了总开关，地址和 key 没动', { barkUrl: 'https://bark.test/dev-key/', barkKey: 'hdr', group: 'AiToEarn' }],
  ])('%s：配置能解析、服务能起、一个请求都不发', async (_, rendered) => {
    const parsed = notifyConfigSchema.safeParse(rendered)
    expect(parsed.success).toBe(true)

    Object.assign(notifyConfig, parsed.data)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const notify = new NotifyService()

    expect(notify.enabled).toBe(false)
    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('两份 schema 必须给出同一套默认值', () => {
    expect(notifyConfigSchema.parse({})).toEqual({
      enabled: false,
      barkUrl: '',
      barkKey: '',
      group: 'AiToEarn',
    })
  })
})
