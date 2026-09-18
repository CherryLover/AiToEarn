import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { RawData, WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { extractBearerToken } from '../devices/device-auth.guard'
import { DeviceAccountSchema } from '../devices/devices.dto'
import { DeviceDoc, DevicesService } from '../devices/devices.service'

/**
 * 为什么用原生 ws 而不是 @nestjs/websockets + platform-socket.io：
 *
 * 1. 契约定的是裸 WebSocket 协议——路径 /ws/device，报文是一行行 JSON，握手时用
 *    Authorization 头带令牌。socket.io 不是裸 WebSocket：它有自己的握手路径
 *    (/socket.io/)、自己的帧格式和一套 engine.io 协商，浏览器插件得额外引一份
 *    socket.io 客户端才能连上。用 ws 的话插件一行 new WebSocket(...) 就够了。
 * 2. 握手鉴权要读原始请求头，ws 的 noServer 模式直接把 IncomingMessage 交到手上，
 *    不用绕 socket.io 的中间件。
 * 3. ws 本来就在依赖树里（被别的包带进来的 8.19.0），装成直接依赖不新增任何下载。
 *
 * 代价是重连、补发这些要插件自己做——但本来也不需要：这条通道只传信号不传数据，
 * 断了只影响到达速度，不影响正确性，定时领取兜底照样领得到活。
 */

/** WebSocket 路径，契约定死 */
export const DEVICE_WS_PATH = '/ws/device'
/** 连上后多久必须发 hello */
const HELLO_TIMEOUT_MS = 10_000
/** 多久发一次 ping */
const PING_INTERVAL_MS = 60_000
/** 连着两次没收到 pong 就断开 */
const MAX_MISSED_PONGS = 2
/**
 * 浏览器的 WebSocket 构造函数没法设请求头。
 * 所以除了契约写的 Authorization 头，也接受把令牌塞进子协议：
 * new WebSocket(url, ['bearer', '<设备令牌>'])
 */
const BEARER_SUBPROTOCOL = 'bearer'

/** 插件发上来的报文，照 contract-skeleton 第三节。多余字段一律丢掉 */
const DeviceWsMessageSchema = z.object({
  type: z.string(),
  version: z.string().max(40).optional(),
  platform: z.string().max(60).optional(),
  capabilities: z.array(z.string()).max(50).optional(),
  accounts: z.array(DeviceAccountSchema).max(100).optional(),
})

interface DeviceConnection {
  socket: WebSocket
  deviceId: string
  userId: string
  capabilities: string[]
  helloReceived: boolean
  missedPongs: number
  helloTimer?: NodeJS.Timeout
}

export interface TaskAvailableSignal {
  userId: string
  taskType: string
  requiredCapability?: string | null
  targetDeviceId?: string | null
}

@Injectable()
export class DeviceWsGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeviceWsGateway.name)
  private readonly connections = new Set<DeviceConnection>()
  private server?: WebSocketServer
  private pingTimer?: NodeJS.Timeout
  private httpServer?: HttpServer
  private readonly upgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void this.handleUpgrade(req, socket, head)
  }

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly devicesService: DevicesService,
  ) {}

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer?.() as HttpServer | undefined
    if (!httpServer || typeof httpServer.on !== 'function') {
      // 网关起不来不能拖垮整个服务：HTTP 领取才是正确性的保证，这里只是催办
      this.logger.warn('拿不到 HTTP server，设备 WebSocket 网关没有启动，设备只能靠定时轮询领活')
      return
    }

    this.httpServer = httpServer
    this.server = new WebSocketServer({
      noServer: true,
      // 客户端用子协议带令牌时，必须回选其中一个，否则浏览器会直接断开
      handleProtocols: protocols => (protocols.has(BEARER_SUBPROTOCOL) ? BEARER_SUBPROTOCOL : false),
    })
    httpServer.on('upgrade', this.upgradeListener)

    this.pingTimer = setInterval(() => this.sweep(), PING_INTERVAL_MS)
    this.logger.log(`设备 WebSocket 网关已挂在 ${DEVICE_WS_PATH}`)
  }

  onApplicationShutdown() {
    if (this.pingTimer)
      clearInterval(this.pingTimer)

    this.httpServer?.off('upgrade', this.upgradeListener)

    for (const connection of this.connections)
      this.dropConnection(connection, 1001, 'server shutdown')

    this.server?.close()
  }

  /**
   * 给能干这活的在线设备发一条催办。
   * **只带 taskType，不带 taskId、不带内容**，设备收到之后走 HTTP 领取。
   * 发送失败一律吞掉：网关挂了不能影响 HTTP 领取。
   */
  notifyTaskAvailable(signal: TaskAvailableSignal): number {
    let notified = 0

    try {
      for (const connection of this.connections) {
        if (connection.userId !== signal.userId)
          continue
        if (signal.targetDeviceId && connection.deviceId !== signal.targetDeviceId)
          continue
        if (signal.requiredCapability && !connection.capabilities.includes(signal.requiredCapability))
          continue
        if (!connection.helloReceived)
          continue

        if (this.send(connection, { type: 'task_available', taskType: signal.taskType }))
          notified++
      }
    }
    catch (error) {
      this.logger.warn(`推送 task_available 失败：${error instanceof Error ? error.message : String(error)}`)
    }

    return notified
  }

  /** 当前有多少台设备连着，运维和测试用 */
  get connectionCount(): number {
    return this.connections.size
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const server = this.server
    if (!server)
      return

    const pathname = new URL(req.url ?? '/', 'http://placeholder').pathname
    if (pathname !== DEVICE_WS_PATH) {
      // 只有我们一个 upgrade 监听器时，没人接手的连接得自己收拾掉，否则 socket 会一直挂着
      if ((this.httpServer?.listenerCount('upgrade') ?? 0) <= 1)
        socket.destroy()
      return
    }

    const token = extractBearerToken(req.headers as Record<string, unknown>) ?? extractSubprotocolToken(req)
    if (!token) {
      rejectUpgrade(socket, 'missing device token')
      return
    }

    let device: DeviceDoc
    try {
      device = await this.devicesService.authenticateToken(token)
    }
    catch {
      rejectUpgrade(socket, 'invalid device token')
      return
    }

    server.handleUpgrade(req, socket, head, ws => this.handleConnection(ws, device))
  }

  /** 单独拆出来是为了能直接喂一个假 socket 进来测 */
  handleConnection(socket: WebSocket, device: DeviceDoc) {
    const connection: DeviceConnection = {
      socket,
      deviceId: device.id,
      userId: device.userId,
      capabilities: device.capabilities ?? [],
      helloReceived: false,
      missedPongs: 0,
    }

    // 连上后 10 秒内必须发 hello，不发就断开
    connection.helloTimer = setTimeout(() => {
      if (!connection.helloReceived)
        this.dropConnection(connection, 4001, 'hello timeout')
    }, HELLO_TIMEOUT_MS)

    this.connections.add(connection)

    socket.on('message', (raw: RawData) => this.handleMessage(connection, raw))
    socket.on('close', () => this.forget(connection))
    socket.on('error', () => this.forget(connection))
  }

  private handleMessage(connection: DeviceConnection, raw: RawData) {
    const message = parseDeviceWsMessage(raw)
    if (!message) {
      this.send(connection, { type: 'error', reason: 'malformed message' })
      return
    }

    switch (message.type) {
      case 'hello': {
        connection.helloReceived = true
        if (connection.helloTimer)
          clearTimeout(connection.helloTimer)

        if (message.capabilities)
          connection.capabilities = message.capabilities

        void this.devicesService.applyHello(connection.deviceId, {
          version: message.version,
          platform: message.platform,
          capabilities: message.capabilities,
          accounts: message.accounts,
        })
        break
      }

      case 'heartbeat': {
        if (!connection.helloReceived)
          break

        void this.devicesService.applyHello(connection.deviceId, {})
        break
      }

      case 'pong': {
        connection.missedPongs = 0
        break
      }

      default: {
        this.send(connection, { type: 'error', reason: 'unknown message type' })
      }
    }
  }

  /** 60 秒一轮：连着两次没回 pong 就断开 */
  private sweep() {
    for (const connection of [...this.connections]) {
      if (connection.missedPongs >= MAX_MISSED_PONGS) {
        this.dropConnection(connection, 4002, 'pong timeout')
        continue
      }

      connection.missedPongs++
      this.send(connection, { type: 'ping' })
    }
  }

  private send(connection: DeviceConnection, payload: Record<string, unknown>): boolean {
    try {
      if (connection.socket.readyState !== WebSocket.OPEN)
        return false

      connection.socket.send(JSON.stringify(payload))
      return true
    }
    catch (error) {
      this.logger.debug(`给设备 ${connection.deviceId} 发消息失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private dropConnection(connection: DeviceConnection, code: number, reason: string) {
    this.forget(connection)
    try {
      connection.socket.close(code, reason)
    }
    catch {
      connection.socket.terminate?.()
    }
  }

  private forget(connection: DeviceConnection) {
    if (connection.helloTimer)
      clearTimeout(connection.helloTimer)

    this.connections.delete(connection)
  }
}

/** 解析插件发上来的一帧。解析不出来返回 null，由调用方回一条 error，不断连接 */
function parseDeviceWsMessage(raw: RawData): z.infer<typeof DeviceWsMessageSchema> | null {
  try {
    const parsed = DeviceWsMessageSchema.safeParse(JSON.parse(raw.toString()))
    return parsed.success ? parsed.data : null
  }
  catch {
    return null
  }
}

/** 从 Sec-WebSocket-Protocol: bearer, <token> 里取令牌 */
function extractSubprotocolToken(req: IncomingMessage): string | undefined {
  const raw = req.headers['sec-websocket-protocol']
  const value = Array.isArray(raw) ? raw.join(',') : raw
  if (typeof value !== 'string')
    return undefined

  const parts = value.split(',').map(part => part.trim()).filter(Boolean)
  const index = parts.indexOf(BEARER_SUBPROTOCOL)
  return index >= 0 ? parts[index + 1] : undefined
}

function rejectUpgrade(socket: Duplex, reason: string) {
  socket.write(`HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\nX-Reject-Reason: ${reason}\r\n\r\n`)
  socket.destroy()
}
