export enum ConfigFileFormat {
  Json = 'json',
  Yaml = 'yaml',
}

export enum ConfigEditorServiceTarget {
  Server = 'server',
  Ai = 'ai',
}

/**
 * `GET config` / `GET ai/config` 的返回值。
 *
 * 字段名照服务端 VO（`libs/config-editor/src/config-editor.vo.ts`，
 * 契约见 `docs/rebuild/contract-runtime-config.md` 3.4）一个字母不差地抄，**不要自己起名**。
 *
 * `config` 是**合并后**的值：`config.yaml`（.env 渲染出来的基石）叠上
 * `config.override.yaml`（运行时覆盖层，网页上改的就写这里）。
 *
 * 后两个字段在网页这边标成可选：老版本服务端不返回它们，
 * 这时候要当成空数组优雅退化，而不是白屏（见 `config/utils/configOverride.ts`）。
 */
export interface ConfigEditorConfigVo {
  config: Record<string, unknown>
  format: ConfigFileFormat
  /** 哪些键路径当前来自运行时覆盖层，形如 ['agent.baseUrl', 'ai.openai.apiKey'] */
  overriddenPaths?: string[]
  /** 顶层受保护键：只能从 .env 改，不接受运行时覆盖，形如 ['auth', 'mongodb'] */
  protectedPaths?: string[]
}

export interface ConfigEditorConfigDto {
  config: Record<string, unknown>
}
