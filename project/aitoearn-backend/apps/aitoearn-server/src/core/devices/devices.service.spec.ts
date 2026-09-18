import { createHash } from 'node:crypto'
import { ResponseCode } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicesService, pairingCodeRedisKey } from './devices.service'

vi.mock('../../config', () => ({
  config: {
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

vi.mock('@yikart/mongodb', () => ({
  DeviceRepository: class DeviceRepository {},
  DeviceStatus: { ONLINE: 'online', OFFLINE: 'offline' },
}))

function createService(overrides: {
  deviceRepository?: Record<string, unknown>
  redis?: Record<string, unknown>
} = {}) {
  const store = new Map<string, string>()
  const deviceRepository = {
    create: vi.fn(async (data: Record<string, unknown>) => ({ id: 'device-1', ...data })),
    countByUserId: vi.fn(async () => 0),
    getByTokenHash: vi.fn(async () => null),
    getByIdAndUserId: vi.fn(async () => null),
    listByUserId: vi.fn(async () => []),
    updateHeartbeatById: vi.fn(async () => ({ id: 'device-1' })),
    updateNameById: vi.fn(async (id: string, name: string) => ({ id, name })),
    updateAsRevokedById: vi.fn(async () => ({ id: 'device-1' })),
    ...overrides.deviceRepository,
  }
  const redis = {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setNx: vi.fn(async (key: string, value: string) => {
      if (store.has(key))
        return false
      store.set(key, value)
      return true
    }),
    del: vi.fn(async (key: string) => store.delete(key)),
    ...overrides.redis,
  }

  const service = new DevicesService(deviceRepository as never, redis as never)
  return { service, deviceRepository, redis, store }
}

const pairInput = {
  code: 'ABCD2345',
  name: '家里的 Mac',
  capabilities: ['xhs'],
  accounts: [{ platform: 'xhs', accountName: '程序杂念' }],
  version: '3.8.4',
  platform: 'macOS 15',
}

describe('devices service · 配对码', () => {
  it('8 位大写，去掉了 0 O 1 I 这些容易看错的字符', async () => {
    const { service } = createService()

    for (let i = 0; i < 50; i++) {
      const { code } = await service.createPairingCode('user-1')
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
    }
  })

  it('码写进 Redis，值是 userId，带 10 分钟过期', async () => {
    const { service, redis } = createService()

    const { code, ttlSeconds, expiresAt } = await service.createPairingCode('user-1')

    expect(redis.setNx).toHaveBeenCalledWith(pairingCodeRedisKey(code), 'user-1', 600)
    expect(ttlSeconds).toBe(600)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('撞上已经发出去的码会换一个，不覆盖别人的', async () => {
    const { service, redis } = createService()
    redis.setNx
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await service.createPairingCode('user-1')

    expect(redis.setNx).toHaveBeenCalledTimes(3)
  })

  it('连着生成不出来就报错，不会死循环', async () => {
    const { service, redis } = createService()
    redis.setNx.mockResolvedValue(false)

    await expect(service.createPairingCode('user-1'))
      .rejects
      .toMatchObject({ code: ResponseCode.DevicePairingCodeGenerateFailed })
  })
})

describe('devices service · 配对', () => {
  let harness: ReturnType<typeof createService>

  beforeEach(() => {
    harness = createService()
    harness.store.set(pairingCodeRedisKey('ABCD2345'), 'user-1')
  })

  it('建设备时只存哈希，明文令牌只在返回值里出现一次', async () => {
    const { service, deviceRepository } = harness

    const { token } = await service.pair(pairInput as never)

    expect(token).toMatch(/^dev_[0-9A-Za-z]{48}$/)
    const created = deviceRepository.create.mock.calls[0]![0] as Record<string, unknown>
    expect(created.tokenHash).toBe(createHash('sha1').update(token).digest('hex'))
    expect(JSON.stringify(created)).not.toContain(token)
    expect(created).toMatchObject({
      userId: 'user-1',
      name: '家里的 Mac',
      capabilities: ['xhs'],
      version: '3.8.4',
      platform: 'macOS 15',
      status: 'online',
    })
  })

  it('配对码不区分大小写，两边的空格也不算数', async () => {
    const { service } = harness

    await expect(service.pair({ ...pairInput, code: '  abcd2345  ' } as never)).resolves.toBeDefined()
  })

  it('码用掉之后从 Redis 删掉', async () => {
    const { service, redis, store } = harness

    await service.pair(pairInput as never)

    expect(redis.del).toHaveBeenCalledWith(pairingCodeRedisKey('ABCD2345'))
    expect(store.has(pairingCodeRedisKey('ABCD2345'))).toBe(false)
  })

  it('码不存在或已过期一律拒绝，不建设备', async () => {
    const { service, deviceRepository } = harness

    await expect(service.pair({ ...pairInput, code: 'ZZZZ9999' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.DevicePairingCodeInvalid })
    expect(deviceRepository.create).not.toHaveBeenCalled()
  })

  it('同一个码被两个人同时提交，只有真正删掉它的那个能过', async () => {
    const { service, redis, deviceRepository } = harness
    redis.del.mockResolvedValueOnce(false)

    await expect(service.pair(pairInput as never))
      .rejects
      .toMatchObject({ code: ResponseCode.DevicePairingCodeUsed })
    expect(deviceRepository.create).not.toHaveBeenCalled()
  })

  it('设备数量到上限就拒绝', async () => {
    const { service, deviceRepository } = harness
    deviceRepository.countByUserId.mockResolvedValue(20)

    await expect(service.pair(pairInput as never))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceLimitExceeded })
  })
})

describe('devices service · 令牌与在线判定', () => {
  it('没带令牌和令牌无效报不同的码', async () => {
    const { service } = createService()

    await expect(service.authenticateToken('  '))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceTokenMissing })
    await expect(service.authenticateToken('dev_whatever'))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceTokenInvalid })
  })

  it('查库用的是哈希，不是明文', async () => {
    const { service, deviceRepository } = createService({
      deviceRepository: { getByTokenHash: vi.fn(async () => ({ id: 'device-1' })) },
    })

    await service.authenticateToken('dev_plain')

    expect(deviceRepository.getByTokenHash).toHaveBeenCalledWith(
      createHash('sha1').update('dev_plain').digest('hex'),
    )
  })

  it('在线看最后心跳：心跳间隔的 3 倍以内算在线', () => {
    const { service } = createService()
    const now = new Date('2026-09-18T12:00:00.000Z')
    const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000)

    expect(service.isOnline(secondsAgo(0), now)).toBe(true)
    expect(service.isOnline(secondsAgo(89), now)).toBe(true)
    expect(service.isOnline(secondsAgo(90), now)).toBe(true)
    expect(service.isOnline(secondsAgo(91), now)).toBe(false)
    expect(service.isOnline(null, now)).toBe(false)
    expect(service.isOnline(undefined, now)).toBe(false)
  })

  it('心跳刷新最后在线时间，并整份覆盖上报的能力和账号', async () => {
    const { service, deviceRepository } = createService()

    const result = await service.heartbeat({ id: 'device-1' } as never, {
      status: 'idle',
      capabilities: ['xhs', 'douyin'],
      accounts: [{ platform: 'xhs' }],
    } as never)

    expect(deviceRepository.updateHeartbeatById).toHaveBeenCalledWith('device-1', {
      status: 'online',
      capabilities: ['xhs', 'douyin'],
      accounts: [{ platform: 'xhs' }],
      version: undefined,
      platform: undefined,
    })
    expect(result.heartbeatSeconds).toBe(30)
  })

  it('webSocket 上的 hello 落库失败不往外抛，连接不能因此断掉', async () => {
    const { service } = createService({
      deviceRepository: {
        updateHeartbeatById: vi.fn(async () => {
          throw new Error('数据库连不上')
        }),
      },
    })

    await expect(service.applyHello('device-1', { capabilities: ['xhs'] })).resolves.toBeUndefined()
  })
})

describe('devices service · 归属', () => {
  it('不是自己的设备一律当成不存在', async () => {
    const { service } = createService()

    await expect(service.getOwnedDevice('device-1', 'user-2'))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceNotFound })
    await expect(service.rename('device-1', 'user-2', '新名字'))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceNotFound })
    await expect(service.revoke('device-1', 'user-2'))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceNotFound })
  })

  it('改名会去掉两边空格，全是空格直接拒绝', async () => {
    const { service, deviceRepository } = createService({
      deviceRepository: { getByIdAndUserId: vi.fn(async () => ({ id: 'device-1', userId: 'user-1' })) },
    })

    await service.rename('device-1', 'user-1', '  书房那台  ')
    expect(deviceRepository.updateNameById).toHaveBeenCalledWith('device-1', '书房那台')

    await expect(service.rename('device-1', 'user-1', '   '))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceNameInvalid })
  })

  it('吊销走的是标记，不是删记录，历史工单还查得到这台设备', async () => {
    const { service, deviceRepository } = createService({
      deviceRepository: { getByIdAndUserId: vi.fn(async () => ({ id: 'device-1', userId: 'user-1' })) },
    })

    await service.revoke('device-1', 'user-1')

    expect(deviceRepository.updateAsRevokedById).toHaveBeenCalledWith('device-1')
  })
})
