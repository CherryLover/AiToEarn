import type { Device, PairingCode, UpdateDeviceParams } from './device.types'
import http from '@/utils/request'

/**
 * 生成一个配对码，10 分钟内有效，填进浏览器插件里完成配对。
 */
export function createDevicePairingCodeApi(silent = true) {
  return http.post<PairingCode>('devices/pairing-code', undefined, silent)
}

/**
 * 设备列表，在线状态由服务端按最后心跳时间算好。
 */
export function getDeviceListApi(silent = true) {
  return http.get<Device[]>('devices/list', undefined, silent)
}

/**
 * 改设备名，其余字段由插件上报，网页不改。
 */
export function updateDeviceApi(id: string, data: UpdateDeviceParams, silent = true) {
  return http.post<Device>(`devices/${id}/update`, data, silent)
}

/**
 * 吊销设备，该设备的令牌立即失效，要再用得重新配对。
 */
export function revokeDeviceApi(id: string, silent = true) {
  return http.delete<void>(`devices/${id}`, undefined, silent)
}
