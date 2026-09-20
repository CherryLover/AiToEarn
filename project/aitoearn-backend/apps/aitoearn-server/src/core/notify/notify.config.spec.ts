import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyConfigSchema } from './notify.config'
import { NotifyService } from './notify.service'

const { notifyConfig, postGuardedJsonMock } = vi.hoisted(() => ({
  notifyConfig: {} as Record<string, unknown>,
  postGuardedJsonMock: vi.fn(),
}))

// 「一个请求都不发」要盯住真正发包的那个函数。**不能盯 fetch**：
// 两条通道现在都走 postGuardedJson（node:http），盯 fetch 等于盯了个永远不会被调的东西
vi.mock('./notify.http', async () => {
  const actual = await vi.importActual<typeof import('./notify.http')>('./notify.http')
  return { ...actual, postGuardedJson: postGuardedJsonMock }
})

// notify.service 现在要读用户配置，会把 @yikart/mongodb 的 schema 全加载一遍；
// 测试环境下 @Prop 拿不到类型元数据，照 manual-publish-notify.spec.ts 的写法桩掉
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

// 真 config 要跑命令行参数解析，测试里起不来，照 notify.service.spec.ts 的写法整个桩掉
vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

/**
 * 「把 Bark 配置清空，一切照常工作、不报错」（contract-stage4 验收第 6 条）。
 *
 * 这条只能在服务器上清空 `.env` 再重新部署才能实跑，上线那一轮没有部署窗口，所以在这里锁死：
 * 下面每个 `rendered` 都是**真的跑 `deploy/oci/render_config.py` 渲染出来的** `notify` 段，
 * 不是手写的假数据。渲染规则见 `render_config.py` 的 `prune()`：`.env` 里留空的变量在 YAML 里是
 * `key:`（解析成 None），渲染时整个键被丢掉——所以清空配置得到的不是一堆空字符串，而是**键不存在**。
 *
 * 为什么非测不可：配置是 `selectConfig` 在进程启动时用 zod 校验的，校验不过直接抛错、服务起不来。
 * 也就是说「配置清空」一旦解析失败，不是推送不工作，而是**整个服务挂掉**。
 *
 * 复现渲染结果（在仓库根目录）：
 * ```
 * NOTIFY_ENABLED= NOTIFY_BARK_URL= NOTIFY_BARK_KEY= NOTIFY_GROUP= DOMAIN=example.test ... \
 *   python3 deploy/oci/render_config.py \
 *     project/aitoearn-backend/apps/aitoearn-server/config/config.yaml \
 *     deploy/oci/overrides/server.yaml /tmp/out.yaml
 * ```
 */
describe('bark 配置清空后服务照常', () => {
  beforeEach(() => {
    // 桩 config 是个共享对象，用例之间必须清干净，免得上一条的开关漏到下一条
    for (const key of Object.keys(notifyConfig))
      delete notifyConfig[key]
    postGuardedJsonMock.mockReset()
    postGuardedJsonMock.mockResolvedValue({ status: 200 })
    // 推送失败只记一行日志，测试里不需要看这些噪音
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['四个变量都留空', {}],
    ['照 .env.example 只留了分组', { group: 'AiToEarn' }],
    ['开关开了但地址和 key 忘了填', { enabled: true, group: 'AiToEarn' }],
    ['整段 notify 都不在配置里', undefined],
    // README「下次重启窗口实跑一次」那一步产生的形态：只清总开关，地址和 key 还在
    ['只清了总开关，地址和 key 没动', { barkUrl: 'https://bark.test/dev-key/', barkKey: 'hdr', group: 'AiToEarn' }],
  ])('%s：配置能解析、服务能起、一个请求都不发', async (_, rendered) => {
    // 1. 配置校验必须过。抛错 = selectConfig 抛错 = 服务起不来
    const parsed = notifyConfigSchema.safeParse(rendered)
    expect(parsed.success).toBe(true)

    // 2. 解析结果必须是「配齐了才算开」，缺一样就当没配
    Object.assign(notifyConfig, parsed.data)
    const notify = new NotifyService()

    expect(notify.enabled).toBe(false)

    // 3. 两个接入点都静默跳过，不抛错、不发请求
    await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' })).resolves.toBe(false)
    await expect(notify.notifyManualPublishPending({ platform: 'xhs' })).resolves.toBe(false)
    expect(postGuardedJsonMock).not.toHaveBeenCalled()
  })

  it('配齐了才真推：三样都填上才开', () => {
    // 同样是真渲染出来的：NOTIFY_ENABLED=true + 地址 + key 都填了
    const parsed = notifyConfigSchema.parse({
      enabled: true,
      barkUrl: 'https://bark.test/dev-key/',
      barkKey: 'hdr',
      group: 'AiToEarn',
    })

    Object.assign(notifyConfig, parsed)
    expect(new NotifyService().enabled).toBe(true)
  })

  it('留空时填的是安全默认值，不是 undefined', () => {
    const parsed = notifyConfigSchema.parse({})

    expect(parsed).toEqual({ enabled: false, barkUrl: '', barkKey: '', group: 'AiToEarn' })
  })
})
