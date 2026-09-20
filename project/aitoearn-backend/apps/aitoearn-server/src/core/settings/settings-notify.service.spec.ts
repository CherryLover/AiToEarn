import { AppException, ResponseCode, UserType } from '@yikart/common'
import { NotifyRuleType } from '@yikart/mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsNotifyService } from './settings-notify.service'

// 真 config 要跑命令行参数解析，测试里起不来，照仓库现有写法整个桩掉
vi.mock('../../config', () => ({ config: { notify: {} } }))

// 测试环境下 @Prop 拿不到类型元数据，照 manual-publish-notify.spec.ts 的写法桩掉
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

/** 公网可路由但不会真连上的地址，省掉测试里的 DNS */
const PUBLIC_URL = 'https://203.0.113.10/dev-key/'

const STORED = {
  userId: 'user-1',
  userType: UserType.User,
  enabled: true,
  barkBaseUrl: PUBLIC_URL,
  barkKey: 'super-secret-key-abcd',
  group: '我的通知',
  rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: true }],
  updatedAt: new Date('2026-09-19T00:00:00.000Z'),
}

describe('设置页的通知配置', () => {
  let stored: typeof STORED | null
  let upsert: ReturnType<typeof vi.fn>
  let sendTest: ReturnType<typeof vi.fn>
  let service: SettingsNotifyService

  beforeEach(() => {
    stored = { ...STORED }
    upsert = vi.fn().mockImplementation(async () => stored)
    sendTest = vi.fn().mockResolvedValue({ success: true, status: 200 })

    service = new SettingsNotifyService(
      {
        getByUserId: vi.fn().mockImplementation(async () => stored),
        upsertByUserId: upsert,
      } as never,
      { enabled: true, sendTest } as never,
    )
  })

  describe('读配置', () => {
    it('key 只回掩码，明文一个字都不出去', async () => {
      const vo = await service.get('user-1')

      expect(vo.barkKeyMask).toBe('••••abcd')
      expect(vo.barkKeyConfigured).toBe(true)
      expect(JSON.stringify(vo)).not.toContain('super-secret-key')
    })

    it('key 短到 4 位以内就整串都不露：留后 4 位等于全给出去了', async () => {
      stored = { ...STORED, barkKey: 'abcd' }

      expect((await service.get('user-1')).barkKeyMask).toBe('••••')
    })

    it('没配过的用户拿到一份默认值，规则开关直接就能显示', async () => {
      stored = null

      const vo = await service.get('user-1')

      expect(vo).toMatchObject({
        enabled: false,
        barkBaseUrl: '',
        barkKeyMask: '',
        barkKeyConfigured: false,
        group: 'AiToEarn',
        updatedAt: null,
      })
      expect(vo.rules).toEqual([{ type: NotifyRuleType.DRAFT_READY, enabled: true }])
    })

    it('告诉网页服务器有没有兜底通道，但不透露它的地址', async () => {
      const vo = await service.get('user-1')

      expect(vo.envFallbackAvailable).toBe(true)
      expect(Object.keys(vo)).not.toContain('barkKey')
    })
  })

  describe('保存配置', () => {
    it('key 传空串表示不改，不会把已经存好的那个冲掉', async () => {
      await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: '',
        group: '我的通知',
      } as never)

      expect(upsert.mock.calls[0][2]).not.toHaveProperty('barkKey')
    })

    it('填了新值才覆盖', async () => {
      await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: 'brand-new-key',
        group: '我的通知',
      } as never)

      expect(upsert.mock.calls[0][2]).toMatchObject({ barkKey: 'brand-new-key' })
    })

    it('第一次配、地址填了但 key 没填：明确告诉用户要填 key', async () => {
      stored = null

      await expect(service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: '',
        group: 'AiToEarn',
      } as never)).rejects.toMatchObject({ code: ResponseCode.SettingsNotifyKeyRequired })
    })

    it('把地址清空 = 不用自己的通道，顺手把库里那把明文 key 也删掉', async () => {
      await service.save('user-1', UserType.User, {
        enabled: false,
        barkBaseUrl: '',
        barkKey: '',
        group: 'AiToEarn',
      } as never)

      expect(upsert.mock.calls[0][2]).toMatchObject({ barkBaseUrl: '', barkKey: '' })
    })

    it.each([
      ['本机回环', 'http://127.0.0.1/dev-key/'],
      ['云元数据地址', 'http://169.254.169.254/latest/meta-data/'],
      ['私有网段', 'http://10.1.2.3:8080/dev-key/'],
      ['IPv6 回环', 'http://[::1]/dev-key/'],
      ['IPv4-mapped 的元数据地址', 'http://[::ffff:169.254.169.254]/'],
    ])('填%s被拒，提示说清楚是地址不允许', async (_, url) => {
      const error = await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: url,
        barkKey: 'a-key',
        group: 'AiToEarn',
      } as never).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(AppException)
      expect((error as AppException).code).toBe(ResponseCode.SettingsNotifyUrlBlocked)
      expect(upsert).not.toHaveBeenCalled()
    })

    it.each([
      ['协议不对', 'ftp://bark.example.com/dev-key/'],
      ['压根不是地址', '这不是地址'],
    ])('%s：按「地址不合法」拒', async (_, url) => {
      await expect(service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: url,
        barkKey: 'a-key',
        group: 'AiToEarn',
      } as never)).rejects.toMatchObject({ code: ResponseCode.SettingsNotifyUrlInvalid })
    })

    it('同一种规则给了两条：说不清以哪条为准，直接拒', async () => {
      await expect(service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: '',
        group: 'AiToEarn',
        rules: [
          { type: NotifyRuleType.DRAFT_READY, enabled: true },
          { type: NotifyRuleType.DRAFT_READY, enabled: false },
        ],
      } as never)).rejects.toMatchObject({ code: ResponseCode.SettingsNotifyRuleInvalid })
    })

    it('不传 rules 表示这次不改规则', async () => {
      await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: '',
        group: 'AiToEarn',
      } as never)

      expect(upsert.mock.calls[0][2]).not.toHaveProperty('rules')
    })

    it('规则是数组存的：关掉 draft_ready 原样落库，结构能再放别的规则', async () => {
      await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: '',
        group: 'AiToEarn',
        rules: [{ type: NotifyRuleType.DRAFT_READY, enabled: false }],
      } as never)

      expect(upsert.mock.calls[0][2].rules).toEqual([{ type: NotifyRuleType.DRAFT_READY, enabled: false }])
    })

    it('分组留空按 AiToEarn 处理', async () => {
      await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: '',
        group: '   ',
      } as never)

      expect(upsert.mock.calls[0][2]).toMatchObject({ group: 'AiToEarn' })
    })

    it('保存完回的还是掩码，不会趁机把明文带出去', async () => {
      const vo = await service.save('user-1', UserType.User, {
        enabled: true,
        barkBaseUrl: PUBLIC_URL,
        barkKey: 'another-secret-wxyz',
        group: 'AiToEarn',
      } as never)

      expect(JSON.stringify(vo)).not.toContain('another-secret')
    })
  })

  describe('发送测试通知', () => {
    it('成功时把结果原样回给网页', async () => {
      expect(await service.sendTest('user-1')).toEqual({ success: true, failure: null, status: 200 })
    })

    it('失败时带上原因码，让网页说清楚是哪一步不对', async () => {
      sendTest.mockResolvedValue({ success: false, failure: 'unauthorized', status: 401 })

      expect(await service.sendTest('user-1')).toEqual({ success: false, failure: 'unauthorized', status: 401 })
    })

    it('什么都没配就别发了，直接让用户先去配', async () => {
      sendTest.mockResolvedValue({ success: false, failure: 'not_configured' })

      await expect(service.sendTest('user-1'))
        .rejects
        .toMatchObject({ code: ResponseCode.SettingsNotifyNotConfigured })
    })
  })
})
