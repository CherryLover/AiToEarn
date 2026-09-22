import type { RuntimeConfigVo } from './runtime-config.types'
import type { ConfigEditorServiceTarget } from '@/api/config-editor/config-editor.types'
import {
  getConfigEditorConfigApi,
  restartConfigEditorServiceApi,
  saveConfigEditorConfigApi,
} from '@/api/config-editor/config-editor.api'

/**
 * 运行时配置的读写，给分步引导页用。
 *
 * **这里不另起一套接口**：走的就是 `/config` 那套覆盖层接口（contract-runtime-config 3.4、4.2），
 * 只是把返回类型放宽成带 `overriddenPaths` / `protectedPaths` 的 `RuntimeConfigVo`。
 * `src/api/config-editor/` 归配置管理页维护，这里**只读不改**，所以包一层在自己目录里。
 */

/** 读合并后的配置，外加哪些键来自覆盖层、哪些顶层键不许覆盖 */
export async function getRuntimeConfigApi(target: ConfigEditorServiceTarget, silent = true) {
  const res = await getConfigEditorConfigApi(target, silent)
  if (!res)
    return null

  // `ConfigEditorConfigVo` 是同一个响应的窄版本，`overriddenPaths` / `protectedPaths`
  // 由服务端在这一轮补上（契约 3.4）。网页按**可选**处理：服务端还没发就走本地兜底名单，
  // 不要因为少两个字段就把整个引导页判死。
  const data: RuntimeConfigVo | undefined = res.data
  return { code: res.code, message: res.message, data }
}

/**
 * 整份提交配置。服务端只把**与 base 不同的部分**写进覆盖层（契约 3.4），
 * 所以这里提交合并后的完整对象是对的，不要自己在网页里算 diff——
 * 算错了会把用户没动过的字段冻结成覆盖值，以后改 `.env` 就改不动了。
 */
export function saveRuntimeConfigApi(
  target: ConfigEditorServiceTarget,
  config: Record<string, unknown>,
  silent = true,
) {
  return saveConfigEditorConfigApi({ config }, target, silent)
}

/**
 * 重启某个服务。
 * `agent` 那一段是热生效的（契约 3.5），其余改完要重启才算数——引导页只在需要时才露出这个按钮。
 */
export function restartRuntimeServiceApi(target: ConfigEditorServiceTarget, silent = true) {
  return restartConfigEditorServiceApi(target, silent)
}
