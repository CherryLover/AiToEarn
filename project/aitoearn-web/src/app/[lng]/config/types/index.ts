/**
 * 配置管理页内部类型
 * 从原来的全局弹窗（`app/layout/ConfigManagerDialog`）整体搬过来，
 * 去掉了弹窗滚动容器相关的字段：页面版一次只渲染一个分区，滚动交给页面本身。
 */

import type { ConfigFileFormat } from '@/api/config-editor/config-editor.types'

export type ConfigPathSegment = string | number
export type ConfigPath = ConfigPathSegment[]
export type ConfigValue = unknown

export interface ConfigSectionView {
  id: string
  label: string
  description: string
  paths: ConfigPath[]
  fieldCount: number
  modifiedFieldCount: number
  notRecommended?: boolean
}

export interface ConfigPathFocusRequest {
  id: number
  path: ConfigPath
}

export interface ConfigEditorStatus {
  service: 'unknown' | 'running' | 'restarting' | 'failed'
  format?: ConfigFileFormat
  dirty: boolean
}

export interface ConfigFormPanelProps {
  /** 当前选中的分区，一次只渲染一个 */
  section: ConfigSectionView
  config: Record<string, unknown>
  originalConfig: Record<string, unknown> | null
  disabled: boolean
  focusRequest: ConfigPathFocusRequest | null
  highlightedPathKey: string
  onFocusRequestHandled: (requestId: number) => void
  onValueChange: (path: ConfigPath, value: ConfigValue) => void
  onNavigateToJson: (path: ConfigPath) => void
}

export interface ConfigFieldProps {
  path: ConfigPath
  fieldKey: string
  value: ConfigValue
  originalValue?: ConfigValue
  disabled: boolean
  depth?: number
  focusPath: ConfigPath | null
  highlightedPathKey: string
  onValueChange: (path: ConfigPath, value: ConfigValue) => void
  onNavigateToJson: (path: ConfigPath) => void
}
