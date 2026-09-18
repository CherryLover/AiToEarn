import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_WS_PATH, DeviceWsGateway } from './device-ws.gateway'

// 网关经由 device-auth.guard 牵出 devices.service，后者会去加载 @yikart/mongodb 的桶文件，
// 那个桶在 vitest 里加载不了（见 execution-tasks.integration.spec.ts 里的说明），这里换成桩
vi.mock('@yikart/mongodb', () => ({
  DeviceRepository: class DeviceRepository {},
  DeviceStatus: { ONLINE: 'online', OFFLINE: 'offline' },
}))

vi.mock('../../config', () => ({
  config: {
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

const OPEN = 1
const CLOSED = 3

function createFakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>()

  return {
    readyState: OPEN,
    sent: [] as Record<string, unknown>[],
    closedWith: null as { code: number, reason: string } | null,
    send(data: string) {
      this.sent.push(JSON.parse(data))
    },
    close(code: number, reason: string) {
      this.closedWith = { code, reason }
      this.readyState = CLOSED
    },
    terminate() {
      this.readyState = CLOSED
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler)
    },
    receive(message: unknown) {
      handlers.get('message')?.(Buffer.from(typeof message === 'string' ? message : JSON.stringify(message)))
    },
    disconnect() {
      handlers.get('close')?.()
    },
  }
}

function createGateway() {
  const devicesService = { applyHello: vi.fn(async () => undefined), authenticateToken: vi.fn() }
  const httpServer = {
    on: vi.fn(),
    off: vi.fn(),
    listenerCount: vi.fn(() => 1),
  }
  const gateway = new DeviceWsGateway(
    { httpAdapter: { getHttpServer: () => httpServer } } as never,
    devicesService as never,
  )

  return { gateway, devicesService, httpServer }
}

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    userId: 'user-1',
    capabilities: ['xhs'],
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('设备 WebSocket 网关 · 连接', () => {
  it('挂在契约定死的路径上', () => {
    const { gateway, httpServer } = createGateway()
    gateway.onApplicationBootstrap()

    expect(DEVICE_WS_PATH).toBe('/ws/device')
    expect(httpServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function))
    gateway.onApplicationShutdown()
  })

  it('拿不到 HTTP server 时只告警，不把服务拖垮', () => {
    const gateway = new DeviceWsGateway({ httpAdapter: { getHttpServer: () => undefined } } as never, {} as never)

    expect(() => gateway.onApplicationBootstrap()).not.toThrow()
    expect(gateway.connectionCount).toBe(0)
  })

  it('10 秒内不发 hello 就断开', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())
    expect(gateway.connectionCount).toBe(1)

    vi.advanceTimersByTime(9_999)
    expect(socket.closedWith).toBeNull()

    vi.advanceTimersByTime(1)
    expect(socket.closedWith).toEqual({ code: 4001, reason: 'hello timeout' })
    expect(gateway.connectionCount).toBe(0)
  })

  it('发了 hello 就不会被超时踢掉，并把能力和版本落库', () => {
    const { gateway, devicesService } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())
    socket.receive({ type: 'hello', version: '3.8.4', capabilities: ['xhs', 'douyin'], accounts: [{ platform: 'xhs' }] })

    vi.advanceTimersByTime(20_000)
    expect(socket.closedWith).toBeNull()
    expect(devicesService.applyHello).toHaveBeenCalledWith('device-1', {
      version: '3.8.4',
      platform: undefined,
      capabilities: ['xhs', 'douyin'],
      accounts: [{ platform: 'xhs' }],
    })
  })

  it('乱七八糟的报文回一条 error，但不断开连接', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())
    socket.receive('这不是 json')
    socket.receive({ noType: true })

    expect(socket.sent).toEqual([
      { type: 'error', reason: 'malformed message' },
      { type: 'error', reason: 'malformed message' },
    ])
    expect(socket.closedWith).toBeNull()
  })

  it('连着两次没回 pong 就断开，回了就一直留着', () => {
    const { gateway } = createGateway()
    const quiet = createFakeSocket()
    const alive = createFakeSocket()

    gateway.onApplicationBootstrap()
    gateway.handleConnection(quiet as never, device())
    gateway.handleConnection(alive as never, device({ id: 'device-2' }))
    quiet.receive({ type: 'hello' })
    alive.receive({ type: 'hello' })

    vi.advanceTimersByTime(60_000)
    alive.receive({ type: 'pong' })
    vi.advanceTimersByTime(60_000)
    alive.receive({ type: 'pong' })

    expect(quiet.closedWith).toBeNull()
    expect(quiet.sent.filter(m => m.type === 'ping')).toHaveLength(2)

    vi.advanceTimersByTime(60_000)
    expect(quiet.closedWith).toEqual({ code: 4002, reason: 'pong timeout' })
    expect(alive.closedWith).toBeNull()

    gateway.onApplicationShutdown()
  })

  it('连接断了就从名单里摘掉', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())
    expect(gateway.connectionCount).toBe(1)

    socket.disconnect()
    expect(gateway.connectionCount).toBe(0)
  })
})

describe('设备 WebSocket 网关 · 催办', () => {
  it('只带 taskType，不带 taskId 也不带内容', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())
    socket.receive({ type: 'hello' })

    gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'publish' })

    expect(socket.sent).toEqual([{ type: 'task_available', taskType: 'publish' }])
  })

  it('能力不匹配的设备不推', () => {
    const { gateway } = createGateway()
    const xhs = createFakeSocket()
    const douyin = createFakeSocket()

    gateway.handleConnection(xhs as never, device({ id: 'device-1' }))
    gateway.handleConnection(douyin as never, device({ id: 'device-2', capabilities: ['douyin'] }))
    xhs.receive({ type: 'hello' })
    douyin.receive({ type: 'hello' })

    const notified = gateway.notifyTaskAvailable({
      userId: 'user-1',
      taskType: 'publish',
      requiredCapability: 'xhs',
    })

    expect(notified).toBe(1)
    expect(xhs.sent).toHaveLength(1)
    expect(douyin.sent).toHaveLength(0)
  })

  it('hello 里报上来的能力覆盖配对时存的', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device({ capabilities: [] }))
    socket.receive({ type: 'hello', capabilities: ['xhs'] })

    expect(gateway.notifyTaskAvailable({
      userId: 'user-1',
      taskType: 'publish',
      requiredCapability: 'xhs',
    })).toBe(1)
  })

  it('别人家的设备收不到', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device({ userId: 'user-2' }))
    socket.receive({ type: 'hello' })

    expect(gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'publish' })).toBe(0)
  })

  it('指定了设备的活只推给那一台', () => {
    const { gateway } = createGateway()
    const target = createFakeSocket()
    const other = createFakeSocket()

    gateway.handleConnection(target as never, device({ id: 'device-1' }))
    gateway.handleConnection(other as never, device({ id: 'device-2' }))
    target.receive({ type: 'hello' })
    other.receive({ type: 'hello' })

    gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'echo', targetDeviceId: 'device-2' })

    expect(target.sent).toHaveLength(0)
    expect(other.sent).toEqual([{ type: 'task_available', taskType: 'echo' }])
  })

  it('还没发 hello 的连接不推', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())

    expect(gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'echo' })).toBe(0)
  })

  it('连接已经不是 open 了也不会抛，只是发不出去', () => {
    const { gateway } = createGateway()
    const socket = createFakeSocket()

    gateway.handleConnection(socket as never, device())
    socket.receive({ type: 'hello' })
    socket.readyState = CLOSED

    expect(() => gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'echo' })).not.toThrow()
    expect(socket.sent).toHaveLength(0)
  })

  it('一个设备发送失败不影响给别的设备推', () => {
    const { gateway } = createGateway()
    const broken = createFakeSocket()
    const healthy = createFakeSocket()
    broken.send = () => {
      throw new Error('socket 炸了')
    }

    gateway.handleConnection(broken as never, device({ id: 'device-1' }))
    gateway.handleConnection(healthy as never, device({ id: 'device-2' }))
    broken.receive({ type: 'hello' })
    healthy.receive({ type: 'hello' })

    expect(gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'echo' })).toBe(1)
    expect(healthy.sent).toHaveLength(1)
  })
})
