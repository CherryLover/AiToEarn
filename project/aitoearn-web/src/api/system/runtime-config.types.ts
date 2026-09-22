/**
 * 运行时配置覆盖层的类型
 *
 * 对应 contract-runtime-config 3.4 的 `ConfigEditorConfigVo`：
 * `GET /config` 返回的是**合并后**的值，外加哪些键路径来自覆盖层、哪些顶层键不许覆盖。
 *
 * 为什么不直接改 `src/api/config-editor/config-editor.types.ts`：
 * 那个目录归配置管理页维护，这里只读不写。两个字段那边现在也声明了，
 * 这里重复声明是为了**不依赖别人的改动节奏**——那边万一回退，引导页照样能编译。
 * 一律**可选**：老版本服务端不回这两个字段，这时候退回本地兜底名单，而不是白屏。
 */

import type { ConfigEditorConfigVo } from '@/api/config-editor/config-editor.types'

export interface RuntimeConfigVo extends ConfigEditorConfigVo {
  /** 哪些键路径的值来自覆盖层，形如 `['agent.baseUrl', 'ai.openai.apiKey']` */
  overriddenPaths?: string[]
  /** 顶层受保护键，形如 `['auth', 'mongodb']`。这些只能从部署环境改，覆盖层会拒 */
  protectedPaths?: string[]
}
