/** 目前只有小红书有采集规格，服务端拒绝其它平台 */
export const COLLECT_PLATFORMS = ['xhs'] as const

export const CREATOR_NOTE_ROW_PAGE_SIZE = 20

/** 指标在页面上的固定顺序，跟平台卡片上的图标顺序一致 */
export const METRIC_KEYS = ['views', 'comments', 'likes', 'collects', 'shares'] as const

export type MetricKey = typeof METRIC_KEYS[number]
