/**
 * 设备（Device）接口类型
 * 字段严格对应服务端 DeviceItemVo / PairingCodeVo（core/devices/devices.vo.ts），
 * 不要在此处自行增删字段或改名。
 */

/**
 * 设备上登录的平台账号。
 * 昵称和平台账号 id 由插件上报，可能缺。
 */
export interface DeviceAccount {
  platform: string
  accountName?: string
  accountId?: string
}

/**
 * Device 数据结构，对应服务端设备列表项。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
export interface Device {
  id: string
  /** 人起的名字，如「家里的 Mac」 */
  name: string
  /** 是否在线，服务端按最后心跳时间算，不看 WebSocket 连接状态 */
  online: boolean
  /** 能干什么，如 ['xhs','douyin'] */
  capabilities: string[]
  /** 登录了哪些号 */
  accounts: DeviceAccount[]
  /** 最后一次心跳时间 */
  lastSeenAt: string | null
  /** 插件版本 */
  version: string | null
  /** 哪台机器，如 macOS 15 */
  platform: string | null
  /** 配对时间 */
  createdAt: string
}

/**
 * PairingCode 数据结构，对应服务端配对码接口返回。
 * 明文设备令牌不会出现在这里，它只在插件配对成功时返回一次。
 */
export interface PairingCode {
  /** 8 位大写字母数字配对码 */
  code: string
  /** 过期时间 */
  expiresAt: string
  /** 还有多少秒过期 */
  ttlSeconds: number
}

/**
 * UpdateDeviceParams 请求参数，只允许改名。
 */
export interface UpdateDeviceParams {
  name: string
}
