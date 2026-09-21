/**
 * 设备接口的路由装配：管理侧（网页登录）和设备侧（插件令牌）两个控制器。
 */
import type { TokenInfo } from '@yikart/aitoearn-auth'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceApiController } from './device-api.controller'
import { DevicesController } from './devices.controller'
import { DevicesService } from './devices.service'

vi.mock('../../config', () => ({
  config: {
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
  },
}))

/** schema 里有联合类型的字段，@Prop 在测试环境推不出类型，这里让它不做事 */
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

const TOKEN = { id: 'user-1' } as TokenInfo
const DEVICE_ID = '68c4b3f0a1b2c3d4e5f60718'
const NOW = new Date('2026-09-21T03:00:00.000Z')

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID,
    name: '家里的 Mac',
    lastSeenAt: NOW,
    capabilities: ['xhs', 'job:echo'],
    accounts: [{ platform: 'xhs', accountName: '四十周' }],
    version: '0.1.0',
    platform: 'macOS 15',
    createdAt: NOW,
    ...overrides,
  }
}

describe('设备管理接口的路由装配', () => {
  let controller: DevicesController
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    service = {
      createPairingCode: vi.fn(),
      listByUserId: vi.fn(),
      isOnline: vi.fn(() => true),
      rename: vi.fn(),
      revoke: vi.fn(),
    }

    // compile() 真的会把 controller 和它身上的装饰器装配一遍，
    // 装饰器写错或依赖缺失在这里就会炸，不用等应用启动
    const moduleRef = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [{ provide: DevicesService, useValue: service }],
    }).compile()

    controller = moduleRef.get(DevicesController)
  })

  it('生成配对码把码和过期时间一起给出来', async () => {
    service.createPairingCode!.mockResolvedValue({ code: 'ABCD1234', expiresAt: NOW, ttlSeconds: 600 })

    const vo = await controller.createPairingCode(TOKEN)

    expect(service.createPairingCode).toHaveBeenCalledWith('user-1')
    expect(vo.code).toBe('ABCD1234')
    expect(vo.ttlSeconds).toBe(600)
  })

  /** 在线与否是服务端按最后心跳算的，前端不该自己拿 lastSeenAt 再算一遍 */
  it('设备列表把在线状态算好再给出去', async () => {
    service.listByUserId!.mockResolvedValue([device(), device({ id: 'd2', lastSeenAt: null })])
    service.isOnline!.mockImplementation((lastSeenAt: Date | null) => lastSeenAt !== null)

    const vos = await controller.list(TOKEN)

    expect(service.listByUserId).toHaveBeenCalledWith('user-1')
    expect(vos[0]!.online).toBe(true)
    expect(vos[1]!.online).toBe(false)
    expect(vos[1]!.lastSeenAt).toBeNull()
  })

  it('能力和账号没上报过时给的是空数组，不是缺字段', async () => {
    service.listByUserId!.mockResolvedValue([device({ capabilities: undefined, accounts: undefined })])

    const vos = await controller.list(TOKEN)

    expect(vos[0]!.capabilities).toEqual([])
    expect(vos[0]!.accounts).toEqual([])
  })

  it('改名之后返回的是改完的设备', async () => {
    service.rename!.mockResolvedValue(device({ name: '书房的 Mac' }))

    const vo = await controller.update(TOKEN, DEVICE_ID, { name: '书房的 Mac' } as never)

    expect(service.rename).toHaveBeenCalledWith(DEVICE_ID, 'user-1', '书房的 Mac')
    expect(vo.name).toBe('书房的 Mac')
  })

  it('吊销不返回任何东西', async () => {
    service.revoke!.mockResolvedValue(undefined)

    await expect(controller.revoke(TOKEN, DEVICE_ID)).resolves.toBeUndefined()
    expect(service.revoke).toHaveBeenCalledWith(DEVICE_ID, 'user-1')
  })
})

describe('设备侧接口的路由装配', () => {
  let controller: DeviceApiController
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    service = { pair: vi.fn(), heartbeat: vi.fn() }

    const moduleRef = await Test.createTestingModule({
      controllers: [DeviceApiController],
      providers: [{ provide: DevicesService, useValue: service }],
    }).compile()

    controller = moduleRef.get(DeviceApiController)
  })

  /** 明文令牌只在配对这一次回传，所以这个字段必须在返回里 */
  it('配对成功时把设备和明文令牌一起返回，并且设备按在线算', async () => {
    service.pair!.mockResolvedValue({ device: device(), token: 'plain-token' })

    const vo = await controller.pair({ code: 'ABCD1234', name: '家里的 Mac' } as never)

    expect(service.pair).toHaveBeenCalledWith({ code: 'ABCD1234', name: '家里的 Mac' })
    expect(vo.token).toBe('plain-token')
    expect(vo.device.online).toBe(true)
  })

  it('心跳返回服务端时间和建议的心跳间隔', async () => {
    service.heartbeat!.mockResolvedValue({ deviceId: DEVICE_ID, serverTime: NOW, heartbeatSeconds: 30 })

    const vo = await controller.heartbeat(device() as never, { capabilities: ['xhs'] } as never)

    expect(service.heartbeat).toHaveBeenCalledWith(device(), { capabilities: ['xhs'] })
    expect(vo.deviceId).toBe(DEVICE_ID)
    expect(vo.heartbeatSeconds).toBe(30)
  })
})
