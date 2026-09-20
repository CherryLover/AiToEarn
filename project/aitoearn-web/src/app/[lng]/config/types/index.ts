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

/**
 * 「展开全部 / 收起全部」的广播信号。
 * 每个可折叠节点自己记开合状态，所以这里只能用一个每次点击都换新对象的信号去打断它们，
 * `id` 单纯是为了让对象引用变化、`useEffect` 能重新跑。
 */
export interface ConfigExpandSignal {
  id: number
  open: boolean
}

export interface ConfigEditorStatus {
  service: 'unknown' | 'running' | 'restarting' | 'failed'
  format?: ConfigFileFormat
  dirty: boolean
}

export interface ConfigFormPanelProps {
  /** 当前选中的分区，一次只渲染一个 */
  section: ConfigSectionView
  /** 全部分区：搜索是跨分区的，不然上百个字段还得先猜在哪一区 */
  sections: ConfigSectionView[]
  config: Record<string, unknown>
  originalConfig: Record<string, unknown> | null
  disabled: boolean
  focusRequest: ConfigPathFocusRequest | null
  highlightedPathKey: string
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onSectionSelect: (sectionId: string) => void
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
  /** 同一层里还有几个分组：兄弟太多就别一起摊开，不然分组等于白分 */
  siblingGroupCount?: number
  /** 搜索结果里显示的来路，比如「渠道配置 / Bilibili」。正常浏览时不给 */
  contextLabel?: string
  focusPath: ConfigPath | null
  highlightedPathKey: string
  expandSignal?: ConfigExpandSignal | null
  onValueChange: (path: ConfigPath, value: ConfigValue) => void
  onNavigateToJson: (path: ConfigPath) => void
}
