import { createZodDto } from '@yikart/common'
import { z } from 'zod'

/** 能力标识，跟平台标识同形，如 xhs、douyin、wechat_channels */
export const DeviceCapabilitySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, '能力标识只能是小写字母开头的短标识')

export const DeviceAccountSchema = z.object({
  platform: z.string().min(1).max(32).describe('平台标识，如 xhs'),
  accountName: z.string().max(120).optional().describe('账号昵称'),
  accountId: z.string().max(120).optional().describe('平台上的账号 id'),
})

const PairDeviceDtoSchema = z.object({
  code: z.string().min(1).max(16).describe('网页上生成的 8 位配对码，不区分大小写'),
  name: z.string().min(1).max(60).describe('设备名，人起的，如「家里的 Mac」'),
  version: z.string().max(40).optional().describe('插件版本'),
  platform: z.string().max(60).optional().describe('哪台机器，如 macOS 15'),
  capabilities: z.array(DeviceCapabilitySchema).max(50).default([]).describe('能干什么'),
  accounts: z.array(DeviceAccountSchema).max(100).default([]).describe('登录了哪些号'),
})
export class PairDeviceDto extends createZodDto(PairDeviceDtoSchema, 'PairDeviceDto') {}

const DeviceHeartbeatDtoSchema = z.object({
  status: z.enum(['idle', 'busy']).default('idle').describe('设备当前忙不忙，只做展示'),
  version: z.string().max(40).optional().describe('插件版本'),
  platform: z.string().max(60).optional().describe('哪台机器'),
  capabilities: z.array(DeviceCapabilitySchema).max(50).optional().describe('能干什么，传了就整份覆盖'),
  accounts: z.array(DeviceAccountSchema).max(100).optional().describe('登录了哪些号，传了就整份覆盖'),
})
export class DeviceHeartbeatDto extends createZodDto(DeviceHeartbeatDtoSchema, 'DeviceHeartbeatDto') {}

const UpdateDeviceDtoSchema = z.object({
  name: z.string().min(1).max(60).describe('新的设备名'),
})
export class UpdateDeviceDto extends createZodDto(UpdateDeviceDtoSchema, 'UpdateDeviceDto') {}

export type DeviceAccountInput = z.infer<typeof DeviceAccountSchema>
