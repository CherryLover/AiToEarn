/**
 * 通知设置接口的路由装配：三个入口都只是把 service 的结果原样交出去。
 */
import type { TokenInfo } from '@yikart/aitoearn-auth'
import { Test } from '@nestjs/testing'
import { UserType } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsNotifyController } from './settings-notify.controller'
import { SettingsNotifyService } from './settings-notify.service'

// 真 config 要跑命令行参数解析，测试里起不来，照仓库现有写法整个桩掉
vi.mock('../../config', () => ({ config: { notify: {} } }))

/** schema 里有联合类型的字段，@Prop 在测试环境推不出类型，这里让它不做事 */
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

const TOKEN = { id: 'user-1' } as TokenInfo

describe('通知设置接口的路由装配', () => {
  let controller: SettingsNotifyController
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    service = { get: vi.fn(), save: vi.fn(), sendTest: vi.fn() }

    // compile() 真的会把 controller 和它身上的装饰器装配一遍，
    // 装饰器写错或依赖缺失在这里就会炸，不用等应用启动
    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsNotifyController],
      providers: [{ provide: SettingsNotifyService, useValue: service }],
    }).compile()

    controller = moduleRef.get(SettingsNotifyController)
  })

  /** barkKey 明文永远不回传，接口只给掩码和一个「已设置」标记 */
  it('读配置只拿到掩码', async () => {
    service.get!.mockResolvedValue({ barkConfigured: true, barkKeyMasked: '••••abcd', enabled: true })

    const vo = await controller.get(TOKEN)

    expect(service.get).toHaveBeenCalledWith('user-1', UserType.User)
    expect(vo.barkKeyMasked).toBe('••••abcd')
  })

  it('保存把表单透传给 service', async () => {
    service.save!.mockResolvedValue({ barkConfigured: true, barkKeyMasked: '••••abcd', enabled: true })
    const dto = { barkKey: 'abcd1234', enabled: true }

    const vo = await controller.save(TOKEN, dto as never)

    expect(service.save).toHaveBeenCalledWith('user-1', UserType.User, dto)
    expect(vo.barkConfigured).toBe(true)
  })

  it('测试发送把结果原样交出去', async () => {
    service.sendTest!.mockResolvedValue({ ok: false, message: 'bark 拒绝了这次请求' })

    const vo = await controller.test(TOKEN)

    expect(service.sendTest).toHaveBeenCalledWith('user-1', UserType.User)
    expect(vo.ok).toBe(false)
  })
})
