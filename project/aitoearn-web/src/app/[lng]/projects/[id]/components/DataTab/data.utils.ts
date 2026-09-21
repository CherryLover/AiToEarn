import type { METRIC_KEYS } from '@/api/creator-notes/creator-notes.constants'
import type { NoteMetrics } from '@/api/creator-notes/creator-notes.types'

/** 指标在页面上的中文名，顺序跟平台卡片上的图标顺序一致 */
export const METRIC_LABELS: Record<typeof METRIC_KEYS[number], string> = {
  views: '浏览',
  comments: '评论',
  likes: '点赞',
  collects: '收藏',
  shares: '分享',
}

export const EMPTY_METRICS: NoteMetrics = {
  views: 0,
  comments: 0,
  likes: 0,
  collects: 0,
  shares: 0,
}

/** 3030 -> 3,030。大数字一眼看不出量级，这里只加千分位，不缩写成 3k */
export function formatMetric(value: number): string {
  return value.toLocaleString('zh-CN')
}

/** 变化量带正负号，0 显示成 `-`，别让一排 `+0` 把真正的变化淹掉 */
export function formatDelta(value: number): string {
  if (value === 0)
    return '—'

  return value > 0 ? `+${formatMetric(value)}` : formatMetric(value)
}

export function deltaTone(value: number): string {
  if (value > 0)
    return 'text-emerald-600 dark:text-emerald-400'
  if (value < 0)
    return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-foreground'
}

/** `2026-09-21T08:28:00.000Z` -> `09-21 16:28`，按浏览器所在时区显示 */
export function formatTime(iso?: string | null): string {
  if (!iso)
    return '—'

  const at = new Date(iso)
  if (Number.isNaN(at.getTime()))
    return '—'

  return at.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 把一组数值画成一条折线的 `points`。
 *
 * 自己画而不是引图表库：这里要的只是「有没有在涨」，
 * 为一条几十像素的折线拖进一个图表库不划算。
 */
export function toSparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0)
    return ''

  if (values.length === 1)
    return `0,${height / 2} ${width},${height / 2}`

  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      // 全都一样高时画中线，不然除零会把整条线画飞
      const y = span === 0 ? height / 2 : height - ((value - min) / span) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
