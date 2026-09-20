/**
 * Agent Store - 常量定义
 * 状态配置、进度配置等常量
 */

/**
 * 状态显示配置
 *
 * color 是直接当 CSS 颜色值用的，所以写成主题变量：进行中一律主色，
 * 完成 / 失败 / 取消走语义色，暗色模式跟着 globals.css 自动切。
 * （原来是一组写死的紫罗兰色，换主色后会变成页面上的紫色孤岛。）
 */
export const STATUS_CONFIG: Record<string, { text: string, color: string }> = {
  THINKING: { text: 'thinking', color: 'var(--primary)' },
  WAITING: { text: 'waiting', color: 'var(--muted-foreground)' },
  GENERATING_CONTENT: { text: 'generatingContent', color: 'var(--primary)' },
  GENERATING_IMAGE: { text: 'generatingImage', color: 'var(--primary)' },
  GENERATING_VIDEO: { text: 'generatingVideo', color: 'var(--primary)' },
  GENERATING_TEXT: { text: 'generatingText', color: 'var(--primary)' },
  COMPLETED: { text: 'completed', color: 'var(--success)' },
  FAILED: { text: 'failed', color: 'var(--destructive)' },
  CANCELLED: { text: 'cancelled', color: 'var(--muted-foreground)' },
}

/** 基础进度配置 */
export const BASE_PROGRESS: Record<string, number> = {
  THINKING: 10,
  WAITING: 20,
  GENERATING_CONTENT: 30,
  GENERATING_TEXT: 40,
  GENERATING_IMAGE: 50,
  GENERATING_VIDEO: 60,
  COMPLETED: 100,
}

/** 生成中的状态列表 */
export const GENERATING_STATUSES = [
  'GENERATING_CONTENT',
  'GENERATING_IMAGE',
  'GENERATING_VIDEO',
  'GENERATING_TEXT',
]
