/**
 * 真的握手：起一个真的 HTTP server，用真的 ws 客户端连上去。
 * 上面那份 spec 用假 socket 测的是逻辑，这份测的是「插件照着契约写，能不能连上」。
 */
import type { AddressInfo } from 'node:net'
import { createServer, Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { DEVICE_WS_PATH, DeviceWsGateway } from './device-ws.gateway'

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

const GOOD_TOKEN = 'dev_good_token'
const DEVICE = { id: 'device-1', userId: 'user-1', capabilities: ['xhs'] }

let server: Server
let gateway: DeviceWsGateway
let baseUrl: string
const sockets: WebSocket[] = []

const devicesService = {
  applyHello: vi.fn(async () => undefined),
  authenticateToken: vi.fn(async (token: string) => {
    if (token !== GOOD_TOKEN)
      throw new Error('无效令牌')
    return DEVICE
  }),
}

function connect(options: { token?: string, subprotocol?: boolean, path?: string } = {}) {
  const url = `${baseUrl}${options.path ?? DEVICE_WS_PATH}`
  const socket = options.subprotocol
    ? new WebSocket(url, ['bearer', options.token!])
    : new WebSocket(url, options.token ? { headers: { authorization: `Bearer ${options.token}` } } : {})

  sockets.push(socket)
  return socket
}

function waitForOpen(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
    socket.once('unexpected-response', (_req, res) => reject(new Error(`http ${res.statusCode}`)))
  })
}

function waitForMessage(socket: WebSocket) {
  return new Promise<Record<string, unknown>>((resolve) => {
    socket.once('message', raw => resolve(JSON.parse(raw.toString())))
  })
}

beforeEach(async () => {
  server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`

  gateway = new DeviceWsGateway(
    { httpAdapter: { getHttpServer: () => server } } as never,
    devicesService as never,
  )
  gateway.onApplicationBootstrap()
})

afterEach(async () => {
  for (const socket of sockets.splice(0))
    socket.close()

  gateway.onApplicationShutdown()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('设备 WebSocket 网关 · 真实握手', () => {
  it('带上 Authorization 头能连上，hello 之后能收到催办', async () => {
    const socket = connect({ token: GOOD_TOKEN })
    await waitForOpen(socket)

    socket.send(JSON.stringify({ type: 'hello', version: '3.8.4', capabilities: ['xhs'] }))
    // 等服务端把 hello 处理完
    await vi.waitFor(() => expect(devicesService.applyHello).toHaveBeenCalled())

    const received = waitForMessage(socket)
    gateway.notifyTaskAvailable({ userId: 'user-1', taskType: 'publish' })

    await expect(received).resolves.toEqual({ type: 'task_available', taskType: 'publish' })
  })

  it('浏览器插件设不了请求头，用子协议带令牌也能连上', async () => {
    const socket = connect({ token: GOOD_TOKEN, subprotocol: true })
    await waitForOpen(socket)

    expect(socket.protocol).toBe('bearer')
  })

  it('令牌不对连不上，握手直接被拒', async () => {
    const socket = connect({ token: 'dev_wrong' })

    await expect(waitForOpen(socket)).rejects.toThrow(/401/)
  })

  it('不带令牌连不上', async () => {
    const socket = connect()

    await expect(waitForOpen(socket)).rejects.toThrow(/401/)
  })

  it('别的路径不归这个网关管', async () => {
    const socket = connect({ token: GOOD_TOKEN, path: '/ws/something-else' })

    await expect(waitForOpen(socket)).rejects.toThrow()
  })
})
