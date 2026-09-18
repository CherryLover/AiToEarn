import { createZodDto } from '@yikart/common'
import { Device, LeanDoc } from '@yikart/mongodb'
import { z } from 'zod'
import { DeviceAccountSchema } from './devices.dto'

const PairingCodeVoSchema = z.object({
  code: z.string().describe('配对码，去插件里填这个'),
  expiresAt: z.coerce.date().describe('过期时间'),
  ttlSeconds: z.number().int().describe('还有多少秒过期'),
})
export class PairingCodeVo extends createZodDto(PairingCodeVoSchema, 'PairingCodeVo') {}

const DeviceItemVoSchema = z.object({
  id: z.string().describe('设备 ID'),
  name: z.string().describe('设备名'),
  online: z.boolean().describe('是否在线，按最后心跳时间算，不看 WebSocket 连接'),
  lastSeenAt: z.coerce.date().nullable().describe('最后一次心跳时间'),
  capabilities: z.array(z.string()).describe('能干哪些平台'),
  accounts: z.array(DeviceAccountSchema).describe('登录了哪些号'),
  version: z.string().nullable().describe('插件版本'),
  platform: z.string().nullable().describe('哪台机器'),
  createdAt: z.coerce.date().describe('配对时间'),
})
export class DeviceItemVo extends createZodDto(DeviceItemVoSchema, 'DeviceItemVo') {}

const DevicePairedVoSchema = z.object({
  device: DeviceItemVoSchema.describe('配对好的设备'),
  token: z.string().describe('设备令牌明文，只在配对成功时返回这一次，之后拿不回来'),
})
export class DevicePairedVo extends createZodDto(DevicePairedVoSchema, 'DevicePairedVo') {}

const DeviceHeartbeatVoSchema = z.object({
  deviceId: z.string().describe('设备 ID'),
  serverTime: z.coerce.date().describe('服务端当前时间'),
  heartbeatSeconds: z.number().int().describe('建议的心跳间隔（秒）'),
})
export class DeviceHeartbeatVo extends createZodDto(DeviceHeartbeatVoSchema, 'DeviceHeartbeatVo') {}

/** 设备文档转出参。online 由调用方按 lastSeenAt 算好传进来，这里不重复判断 */
export function toDeviceItemVo(device: LeanDoc<Device>, online: boolean): DeviceItemVo {
  return DeviceItemVo.create({
    id: device.id,
    name: device.name,
    online,
    lastSeenAt: device.lastSeenAt ?? null,
    capabilities: device.capabilities ?? [],
    accounts: device.accounts ?? [],
    version: device.version ?? null,
    platform: device.platform ?? null,
    createdAt: device.createdAt,
  })
}
