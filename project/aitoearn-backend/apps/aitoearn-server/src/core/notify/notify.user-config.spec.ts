import { Logger } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { NotifyRuleType } from '@yikart/mongodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotifyUrlRejected } from './notify-url.guard'
import { NotifyService } from './notify.service'

const { notifyConfig, postGuardedJsonMock } = vi.hoisted(() => ({
  notifyConfig: {} as Record<string, unknown>,
  postGuardedJsonMock: vi.fn(),
}))

// 真 config 要跑命令行参数解析，测试里起不来，照仓库现有写法整个桩掉
vi.mock('../../config', () => ({
  config: {
    get notify() {
      return notifyConfig
    },
  },
}))

// 测试环境下 @Prop 拿不到类型元数据，照 manual-publish-notify.spec.ts 的写法桩掉
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

/**
 * 发包那一层（含 SSRF 校验、重定向、超时）由 `notify.http.spec.ts` 和 `notify.service.spec.ts` 自己盯，
 * 这里只关心「用谁的配置、发不发」。
 *
 * **两条通道现在走的是同一个函数**，所以这个桩既能接住用户那条也能接住 `.env` 兜底那条，
 * 靠第一个参数（地址）和第四个参数（`allowPrivateAddress`）区分。
 */
vi.mock('./notify.http', async () => {
  const actual = await vi.importActual<typeof import('./notify.http')>('./notify.http')
  return { ...actual, postGuardedJson: postGuardedJsonMock }
})

const USER_SETTING = {
  userId: 'user-1',
  userType: UserType.User,
  enabled: true,
  barkBaseUrl: 'https://bark.user.example/user-device-key/',
  barkKey: 'user-header-key',
  group: '我的通知',
  rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }],
}

const ENV_SETTING = {
  enabled: true,
  barkUrl: 'https://bark.env.example/env-device-key/',
  barkKey: 'env-header-key',
  group: 'AiToEarn',
}

/**
 * 取配置的顺序（contract-settings 第五节）：
 * 总开关关掉 → 一条都不推；总开关开着但地址没填齐 → 退回 `.env`；都没有 → 静默跳过（**行为不变**）。
 */
describe('推送读用户配置', () => {
  let getByUserId: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.spyOn>

  function createService(setting: unknown = null) {
    getByUserId = vi.fn().mockResolvedValue(setting)
    return new NotifyService({ getByUserId } as never)
  }

  /** 最后一次发包的参数 */
  function lastPost() {
    const [url, headers, body, options] = postGuardedJsonMock.mock.calls.at(-1) as [
      string,
      Record<string, string>,
      string,
      { allowPrivateAddress?: boolean } | undefined,
    ]
    return { url, headers, body: JSON.parse(body) as Record<string, string>, options }
  }

  beforeEach(() => {
    for (const key of Object.keys(notifyConfig))
      delete notifyConfig[key]
    Object.assign(notifyConfig, ENV_SETTING)

    postGuardedJsonMock.mockReset()
    postGuardedJsonMock.mockResolvedValue({ status: 200 })
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('用户配了自己的通道', () => {
    it('走用户的地址和 key，用用户的分组，不碰 .env 那条', async () => {
      const notify = createService(USER_SETTING)

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(true)

      expect(postGuardedJsonMock).toHaveBeenCalledTimes(1)
      const { url, headers, body } = lastPost()
      expect(url).toBe(USER_SETTING.barkBaseUrl)
      expect(headers).toMatchObject({ 'bark-key': 'user-header-key' })
      expect(body.group).toBe('我的通知')
    })

    it('用户填的地址一律不放行内网', async () => {
      const notify = createService(USER_SETTING)

      await notify.send({ title: '标题', body: '正文' }, { userId: 'user-1' })

      expect(lastPost().options).toMatchObject({ allowPrivateAddress: false })
    })

    it('内容照样截断：标题 30 字、正文 100 字', async () => {
      const notify = createService(USER_SETTING)

      await notify.send({ title: '标'.repeat(80), body: '正'.repeat(500) }, { userId: 'user-1' })

      const { body } = lastPost()
      expect(Array.from(body.title)).toHaveLength(30)
      expect(Array.from(body.body)).toHaveLength(100)
    })
  })

  /**
   * 总开关是**第一层**筛子：关掉就一条都不推。
   *
   * 初版按契约字面实现成「用户没配或没开就退回 .env」，结果用户把开关关了还在收通知——
   * 反直觉，这一轮改掉了（contract-settings 第五节）。
   */
  describe('总开关关掉就彻底不推', () => {
    it('用户配了地址也不推：关掉 = 我不想收，不是「改用服务器的」', async () => {
      const notify = createService({ ...USER_SETTING, enabled: false })

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(false)
      await expect(notify.send({ title: '标题', body: '正文' }, { userId: 'user-1' })).resolves.toBe(false)

      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })

    it('.env 兜底通道配齐了也不走', async () => {
      const notify = createService({ ...USER_SETTING, enabled: false })

      const result = await notify.deliver({ title: '标题', body: '正文' }, { userId: 'user-1' })

      expect(result).toEqual({ success: false, failure: 'not_configured' })
      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })

    it('规则还开着也不推：规则是总开关之下的第二层筛子，不是替代品', async () => {
      const notify = createService({
        ...USER_SETTING,
        enabled: false,
        rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }],
      })

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(false)
      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })

    it('别的用户不受影响：关的是他自己那条配置', async () => {
      const notify = new NotifyService({
        getByUserId: vi.fn(async (userId: string) => (
          userId === 'user-1' ? { ...USER_SETTING, enabled: false } : null
        )),
      } as never)

      await expect(notify.send({ title: '标题', body: '正文' }, { userId: 'user-1' })).resolves.toBe(false)
      await expect(notify.send({ title: '标题', body: '正文' }, { userId: 'user-2' })).resolves.toBe(true)
      expect(lastPost().url).toBe(ENV_SETTING.barkUrl)
    })
  })

  describe('退回 .env 兜底', () => {
    it('用户压根没配过', async () => {
      const notify = createService(null)

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(true)

      expect(lastPost().url).toBe(ENV_SETTING.barkUrl)
    })

    it('用户开着总开关但没填地址', async () => {
      const notify = createService({ ...USER_SETTING, barkBaseUrl: '' })

      await notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })

      expect(lastPost().url).toBe(ENV_SETTING.barkUrl)
    })

    it('用户填了地址但没填 key，配置不完整也算没填齐', async () => {
      const notify = createService({ ...USER_SETTING, barkKey: '' })

      await notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })

      expect(lastPost().url).toBe(ENV_SETTING.barkUrl)
    })

    it('没传 userId 的调用方一律只走 .env：阶段 4 的接入点行为不变', async () => {
      const notify = createService(USER_SETTING)

      await notify.notifyManualPublishPending({ platform: 'xhs' })

      expect(getByUserId).not.toHaveBeenCalled()
      expect(lastPost().url).toBe(ENV_SETTING.barkUrl)
    })

    it('数据库读不出来时退回 .env，不把异常甩给主流程', async () => {
      const notify = new NotifyService({
        getByUserId: vi.fn().mockRejectedValue(new Error('mongo 挂了')),
      } as never)

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(true)
      expect(lastPost().url).toBe(ENV_SETTING.barkUrl)
    })

    it('兜底通道放行内网地址（运维可能把 Bark 装在同机），但走的是同一套带校验的实现', async () => {
      const notify = createService(null)

      await notify.send({ title: '标题', body: '正文' }, { userId: 'user-1' })

      expect(postGuardedJsonMock).toHaveBeenCalledTimes(1)
      expect(lastPost().options).toMatchObject({ allowPrivateAddress: true })
    })
  })

  describe('规则', () => {
    it('把 draft_ready 关掉：AI 生成完不推，连兜底通道都不走', async () => {
      const notify = createService({
        ...USER_SETTING,
        rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }],
      })

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(false)

      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })

    it('规则关掉时返回的原因是 rule_disabled，不是「没配」', async () => {
      const notify = createService({
        ...USER_SETTING,
        rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }],
      })

      const result = await notify.deliver(
        { title: '标题', body: '正文' },
        { userId: 'user-1', rule: NotifyRuleType.DRAFT_READY },
      )

      expect(result).toEqual({ success: false, failure: 'rule_disabled' })
    })

    it('用户没填自己的地址、走兜底通道时，规则照样算数', async () => {
      const notify = createService({
        ...USER_SETTING,
        barkBaseUrl: '',
        rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }],
      })

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(false)
      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })

    it('规则只管自己那一类：draft_ready 关了，待人工发布的提醒照推', async () => {
      const notify = createService({
        ...USER_SETTING,
        rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }],
      })

      await expect(notify.notifyManualPublishPending({ platform: 'xhs' }, { userId: 'user-1' })).resolves.toBe(true)
      expect(postGuardedJsonMock).toHaveBeenCalledTimes(1)
    })

    it('库里没有这条规则时当作开着，不会因为漏了一条就不推', async () => {
      const notify = createService({ ...USER_SETTING, rules: [] })

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(true)
    })
  })

  describe('没配就静默跳过（行为不变）', () => {
    it.each([
      ['.env 整段空着', {}],
      ['.env 开关开了但地址和 key 没填', { enabled: true }],
      ['.env 填了地址没填 key', { enabled: true, barkUrl: 'https://bark.env.example/k/' }],
    ])('用户没配 + %s：一个请求都不发，也不抛错', async (_, env) => {
      for (const key of Object.keys(notifyConfig))
        delete notifyConfig[key]
      Object.assign(notifyConfig, env)
      const notify = createService(null)

      await expect(notify.notifyDraftReady({ projectName: 'fortyweeks' }, { userId: 'user-1' })).resolves.toBe(false)
      await expect(notify.notifyManualPublishPending({ platform: 'xhs' })).resolves.toBe(false)
      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })

    it('连数据库都没接上也不炸', async () => {
      for (const key of Object.keys(notifyConfig))
        delete notifyConfig[key]

      await expect(new NotifyService().send({ title: '标题', body: '正文' }, { userId: 'user-1' }))
        .resolves
        .toBe(false)
    })
  })

  describe('失败不影响主流程，也不泄露地址和 key', () => {
    it('地址被拒时返回 false，日志里不出现地址和 key', async () => {
      postGuardedJsonMock.mockRejectedValue(new NotifyUrlRejected('blocked'))
      const notify = createService(USER_SETTING)

      await expect(notify.send({ title: '标题', body: '正文' }, { userId: 'user-1' })).resolves.toBe(false)

      const logged = warn.mock.calls.map(call => String(call[0])).join('\n')
      expect(logged).toContain('url_blocked')
      expect(logged).not.toContain('bark.user.example')
      expect(logged).not.toContain('user-header-key')
    })

    it('对端说 key 不对（401）：认成 unauthorized，不抛错', async () => {
      postGuardedJsonMock.mockResolvedValue({ status: 401 })
      const notify = createService(USER_SETTING)

      const result = await notify.deliver({ title: '标题', body: '正文' }, { userId: 'user-1' })

      expect(result).toEqual({ success: false, failure: 'unauthorized', status: 401 })
    })

    it('对端 500：认成 rejected，不抛错', async () => {
      postGuardedJsonMock.mockResolvedValue({ status: 500 })
      const notify = createService(USER_SETTING)

      const result = await notify.deliver({ title: '标题', body: '正文' }, { userId: 'user-1' })

      expect(result).toEqual({ success: false, failure: 'rejected', status: 500 })
    })

    it('.env 那条超时时也只记原因码，不把原始错误（可能带地址）打出去', async () => {
      const { NotifyTransportError } = await vi.importActual<typeof import('./notify.http')>('./notify.http')
      postGuardedJsonMock.mockRejectedValue(new NotifyTransportError('timeout'))
      const notify = createService(null)

      await expect(notify.send({ title: '标题', body: '正文' }, { userId: 'user-1' })).resolves.toBe(false)

      const logged = warn.mock.calls.map(call => String(call[0])).join('\n')
      expect(logged).toContain('timeout')
      expect(logged).not.toContain('bark.env.example')
      expect(logged).not.toContain('env-header-key')
    })
  })

  describe('测试通知', () => {
    it('标题写明是测试，走的是和正常推送同一条链路', async () => {
      const notify = createService(USER_SETTING)

      const result = await notify.sendTest({ userId: 'user-1' })

      expect(result.success).toBe(true)
      expect(lastPost().body.title).toContain('测试')
    })

    it('什么都没配时告诉调用方 not_configured，而不是假装发成功', async () => {
      for (const key of Object.keys(notifyConfig))
        delete notifyConfig[key]
      const notify = createService(null)

      expect(await notify.sendTest({ userId: 'user-1' })).toEqual({ success: false, failure: 'not_configured' })
    })

    it('总开关关着时测试也不发：真发一条只会让人以为推送在工作', async () => {
      const notify = createService({ ...USER_SETTING, enabled: false })

      expect(await notify.sendTest({ userId: 'user-1' })).toEqual({ success: false, failure: 'not_configured' })
      expect(postGuardedJsonMock).not.toHaveBeenCalled()
    })
  })
})
