import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { Device, DeviceRepository, DeviceStatus, LeanDoc } from '@yikart/mongodb'
import { RedisService } from '@yikart/redis'
import { customAlphabet } from 'nanoid'
import { config } from '../../config'
import { DeviceAccountInput, DeviceHeartbeatDto, PairDeviceDto } from './devices.dto'

/** 设备令牌前缀，跟 API Key 的 ai_ 区分开，一眼能看出是哪种凭证 */
const DEVICE_TOKEN_PREFIX = 'dev_'

/** 配对码字母表：大写字母 + 数字，去掉 0 O 1 I 这类肉眼容易看错的 */
const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const PAIRING_CODE_LENGTH = 8
/** 配对码撞车时重试几次 */
const PAIRING_CODE_MAX_TRIES = 5

/** 一个用户最多挂多少台设备 */
const MAX_DEVICES_PER_USER = 20

const generateToken = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 48)
const generatePairingCode = customAlphabet(PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH)

export type DeviceDoc = LeanDoc<Device>

/** WebSocket 上那条 hello 带来的信息，跟心跳共用一套落库逻辑 */
export interface DeviceHelloInput {
  version?: string
  platform?: string
  capabilities?: string[]
  accounts?: DeviceAccountInput[]
}

export function pairingCodeRedisKey(code: string): string {
  return `device:pair:${code}`
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name)

  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly redis: RedisService,
  ) {}

  /**
   * 生成配对码。存 Redis 不建表，省一套过期清理。
   * 值是 userId，插件拿码来换令牌时才知道这台设备归谁。
   */
  async createPairingCode(userId: string) {
    const ttlSeconds = config.device.pairingCodeTtlSeconds

    for (let i = 0; i < PAIRING_CODE_MAX_TRIES; i++) {
      const code = generatePairingCode()
      // setNx：撞上已经发出去还没用的码就换一个，绝不覆盖别人的
      const saved = await this.redis.setNx(pairingCodeRedisKey(code), userId, ttlSeconds)
      if (saved) {
        return {
          code,
          ttlSeconds,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        }
      }
    }

    throw new AppException(ResponseCode.DevicePairingCodeGenerateFailed)
  }

  /**
   * 用配对码换设备令牌。明文令牌只在这里返回一次，库里存的是哈希。
   * 先把码从 Redis 删掉再建设备：DEL 只对真正删掉的那个调用方返回 1，
   * 同一个码被两个人同时提交时只有一个能过。
   */
  async pair(dto: PairDeviceDto) {
    const code = dto.code.trim().toUpperCase()
    const key = pairingCodeRedisKey(code)

    const userId = await this.redis.get(key)
    if (!userId)
      throw new AppException(ResponseCode.DevicePairingCodeInvalid)

    const consumed = await this.redis.del(key)
    if (!consumed)
      throw new AppException(ResponseCode.DevicePairingCodeUsed)

    const activeCount = await this.deviceRepository.countByUserId(userId)
    if (activeCount >= MAX_DEVICES_PER_USER)
      throw new AppException(ResponseCode.DeviceLimitExceeded)

    const rawToken = `${DEVICE_TOKEN_PREFIX}${generateToken()}`
    const device = await this.deviceRepository.create({
      userId,
      userType: UserType.User,
      name: dto.name.trim(),
      tokenHash: this.hashToken(rawToken),
      capabilities: dto.capabilities ?? [],
      accounts: dto.accounts ?? [],
      version: dto.version,
      platform: dto.platform,
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
    })

    return { device, token: rawToken }
  }

  /** 设备令牌换设备。吊销过的查不到，令牌立即失效靠这一条 */
  async authenticateToken(rawToken: string): Promise<DeviceDoc> {
    const token = rawToken.trim()
    if (!token)
      throw new AppException(ResponseCode.DeviceTokenMissing)

    const device = await this.deviceRepository.getByTokenHash(this.hashToken(token))
    if (!device)
      throw new AppException(ResponseCode.DeviceTokenInvalid)

    return device
  }

  /** 心跳：刷新 lastSeenAt，顺带把上报上来的能力和账号整份覆盖 */
  async heartbeat(device: DeviceDoc, dto: DeviceHeartbeatDto) {
    await this.deviceRepository.updateHeartbeatById(device.id, {
      status: DeviceStatus.ONLINE,
      capabilities: dto.capabilities,
      accounts: dto.accounts,
      version: dto.version,
      platform: dto.platform,
    })

    return {
      deviceId: device.id,
      serverTime: new Date(),
      heartbeatSeconds: config.device.heartbeatSeconds,
    }
  }

  /** WebSocket 上的 hello / heartbeat 也走同一套落库，写失败只记日志，不影响连接 */
  async applyHello(deviceId: string, input: DeviceHelloInput) {
    try {
      await this.deviceRepository.updateHeartbeatById(deviceId, {
        status: DeviceStatus.ONLINE,
        capabilities: input.capabilities,
        accounts: input.accounts,
        version: input.version,
        platform: input.platform,
      })
    }
    catch (error) {
      this.logger.warn(error, `设备 ${deviceId} 心跳落库失败`)
    }
  }

  async listByUserId(userId: string) {
    return await this.deviceRepository.listByUserId(userId)
  }

  async getOwnedDevice(id: string, userId: string): Promise<DeviceDoc> {
    const device = await this.deviceRepository.getByIdAndUserId(id, userId)
    if (!device)
      throw new AppException(ResponseCode.DeviceNotFound)

    return device
  }

  async rename(id: string, userId: string, name: string) {
    await this.getOwnedDevice(id, userId)

    const trimmed = name.trim()
    if (!trimmed)
      throw new AppException(ResponseCode.DeviceNameInvalid)

    const updated = await this.deviceRepository.updateNameById(id, trimmed)
    if (!updated)
      throw new AppException(ResponseCode.DeviceNotFound)

    return updated
  }

  /** 吊销：令牌立即失效。历史工单上的 deviceId 还在，便于回看是哪台机器干的 */
  async revoke(id: string, userId: string) {
    await this.getOwnedDevice(id, userId)
    await this.deviceRepository.updateAsRevokedById(id)
  }

  /**
   * 在线判定：最后心跳在 heartbeatSeconds * 3 之内算在线。
   * 不看 WebSocket 连接状态——浏览器休眠时连接会悄悄断掉，那不代表设备没了。
   */
  isOnline(lastSeenAt?: Date | null, now: Date = new Date()): boolean {
    if (!lastSeenAt)
      return false

    const windowMs = config.device.heartbeatSeconds * 3 * 1000
    return now.getTime() - new Date(lastSeenAt).getTime() <= windowMs
  }

  private hashToken(rawToken: string): string {
    return createHash('sha1').update(rawToken).digest('hex')
  }
}
