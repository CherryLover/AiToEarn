import { EventEmitter } from 'node:events'

/**
 * 保存运行时覆盖层之后广播的事件。
 *
 * `config-editor` 是独立 lib，被两个 app 复用，**不能反向依赖任何 app**。
 * 需要「保存完不重启就生效」的模块（目前只有 aitoearn-ai 的 `ClaudeCodeRouterService`）
 * 自己订阅这里，lib 侧只管广播、不认识订阅方。
 */
export interface ConfigOverrideSavedEvent {
  /** 保存之后的完整配置：基础配置 + 覆盖层深合并、跑完 zod 的结果 */
  config: Record<string, unknown>
  /** 这次保存真正变了的顶层键，形如 `['agent']`；订阅方据此判断要不要动 */
  changedKeys: string[]
}

export const CONFIG_OVERRIDE_SAVED_EVENT = 'config-override.saved'

const emitter = new EventEmitter()
// 订阅方数量可数（每个进程一两个），但别让 Node 在多次热重载后误报泄漏
emitter.setMaxListeners(20)

/** 订阅保存事件，返回取消订阅的函数 */
export function onConfigOverrideSaved(
  listener: (event: ConfigOverrideSavedEvent) => void,
): () => void {
  emitter.on(CONFIG_OVERRIDE_SAVED_EVENT, listener)
  return () => {
    emitter.off(CONFIG_OVERRIDE_SAVED_EVENT, listener)
  }
}

/** 广播保存事件。订阅方自己吞掉异常，这里不替它们兜底以外的事 */
export function emitConfigOverrideSaved(event: ConfigOverrideSavedEvent): void {
  emitter.emit(CONFIG_OVERRIDE_SAVED_EVENT, event)
}
