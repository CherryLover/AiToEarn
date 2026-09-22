import type { ReadinessVo } from './readiness.types'
import http from '@/utils/request'

/**
 * 读一次就绪检查结果。
 *
 * 服务端逐项返回、不抛异常（contract-runtime-config 4.1），所以这里一律 `silent`：
 * 就绪检查是**背景信息**，不能因为它失败就在用户脸上弹一个红框——
 * 该说的话由横幅和引导页去说。
 *
 * 要登录。未登录时不要调用：调了也只会拿到 401。
 */
export function getSystemReadinessApi(silent = true) {
  return http.get<ReadinessVo>('system/readiness', undefined, silent)
}
