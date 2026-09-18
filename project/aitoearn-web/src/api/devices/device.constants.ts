/**
 * 设备（Device）接口常量
 * 与服务端契约保持一致：心跳节奏、配对码有效期、业务错误码。
 */

/** 心跳间隔（秒），对应服务端配置 device.heartbeatSeconds */
export const DEVICE_HEARTBEAT_SECONDS = 30

/** 在线判定倍数：lastSeenAt 在 DEVICE_HEARTBEAT_SECONDS * 该值之内算在线 */
export const DEVICE_ONLINE_FACTOR = 3

/** 配对码有效期（秒），对应服务端配置 device.pairingCodeTtlSeconds */
export const DEVICE_PAIRING_CODE_TTL_SECONDS = 600

/** 配对码位数 */
export const DEVICE_PAIRING_CODE_LENGTH = 8

/** 设备名最长长度，跟服务端 UpdateDeviceDto 一致 */
export const DEVICE_NAME_MAX_LENGTH = 60

/**
 * 设备相关业务错误码，对应服务端 ResponseCode 20300 段。
 * 其中带「插件侧」注释的只有浏览器插件会碰到，网页不做单独文案。
 */
export const DEVICE_ERROR_CODE = {
  /** 插件侧：配对码不存在或已过期 */
  PairingCodeInvalid: 20300,
  /** 插件侧：配对码已被用过 */
  PairingCodeUsed: 20301,
  /** 配对码生成失败 */
  PairingCodeGenerateFailed: 20302,
  /** 设备不存在或不属于当前用户 */
  NotFound: 20303,
  /** 插件侧：设备令牌无效 */
  TokenInvalid: 20304,
  /** 插件侧：请求没带设备令牌 */
  TokenMissing: 20305,
  /** 设备已被吊销 */
  Revoked: 20306,
  /** 设备不在线 */
  Offline: 20307,
  /** 设备名不合规 */
  NameInvalid: 20308,
  /** 设备数量超出上限 */
  LimitExceeded: 20309,
  /** 插件侧：上报的能力不合规 */
  CapabilityInvalid: 20310,
  /** 插件侧：心跳内容不合规 */
  HeartbeatInvalid: 20311,
  /** 插件侧：该设备已配对过 */
  AlreadyPaired: 20312,
  /** 插件侧：WebSocket 鉴权失败 */
  WsUnauthorized: 20313,
  /** 插件侧：连上后 10 秒没发 hello */
  WsHelloTimeout: 20314,
  /** 插件侧：WebSocket 消息格式不对 */
  WsMessageInvalid: 20315,
} as const

/**
 * 已知能力（插件能在哪些平台干活）与文案键的对应。
 * 服务端不限定取值，出现没收录的能力时直接显示原始值。
 */
export const DEVICE_CAPABILITY_LABEL_KEYS: Record<string, string> = {
  xhs: 'capability.xhs',
  douyin: 'capability.douyin',
  wechat_channels: 'capability.wechatChannels',
  bilibili: 'capability.bilibili',
  kwai: 'capability.kwai',
  wxGzh: 'capability.wxGzh',
}
