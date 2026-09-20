import type { NotifySetting, NotifyTestResult, SaveNotifySettingParams } from './notify.types'
import http from '@/utils/request'

/**
 * 读当前用户的通知设置。
 * barkKey 只回掩码，明文不出服务端。
 */
export function getNotifySettingApi(silent = true) {
  return http.get<NotifySetting>('settings/notify', undefined, silent)
}

/**
 * 保存通知设置。
 * `barkKey` 传空串表示不改动已存的 key，只有传了新值才覆盖。
 */
export function saveNotifySettingApi(data: SaveNotifySettingParams, silent = true) {
  return http.post<NotifySetting>('settings/notify', data, silent)
}

/**
 * 用当前已保存的配置真发一条测试通知，标题里写明是测试。
 * 地址校验、超时、网段拦截都在服务端做，这里只负责把结果显示出来。
 */
export function testNotifySettingApi(silent = true) {
  return http.post<NotifyTestResult>('settings/notify/test', undefined, silent)
}
