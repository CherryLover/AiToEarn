import { describe, expect, it } from 'vitest'
import { METRIC_KEYS } from '@/api/creator-notes/creator-notes.constants'
import {
  deltaTone,
  EMPTY_METRICS,
  formatDelta,
  formatMetric,
  formatTime,
  METRIC_LABELS,
  toSparklinePoints,
} from './data.utils'

describe('指标常量', () => {
  /** 少一个指标，表头和数据列就会错位 */
  it('每个指标都有中文名和零值', () => {
    for (const key of METRIC_KEYS) {
      expect(METRIC_LABELS[key]).toBeTruthy()
      expect(EMPTY_METRICS[key]).toBe(0)
    }
  })
})

describe('formatMetric', () => {
  it('大数字加千分位', () => {
    expect(formatMetric(3030)).toBe('3,030')
    expect(formatMetric(0)).toBe('0')
    expect(formatMetric(1234567)).toBe('1,234,567')
  })
})

describe('formatDelta', () => {
  it('涨了带加号', () => {
    expect(formatDelta(1200)).toBe('+1,200')
  })

  it('跌了带减号', () => {
    expect(formatDelta(-30)).toBe('-30')
  })

  /** 没变化显示破折号：一排 `+0` 会把真正的变化淹掉 */
  it('没变化显示破折号', () => {
    expect(formatDelta(0)).toBe('—')
  })
})

describe('deltaTone', () => {
  it('涨绿、跌红、不变灰', () => {
    expect(deltaTone(1)).toContain('emerald')
    expect(deltaTone(-1)).toContain('rose')
    expect(deltaTone(0)).toBe('text-muted-foreground')
  })
})

describe('formatTime', () => {
  it('iSO 时间按本地时区显示到分钟', () => {
    const shown = formatTime('2026-09-21T08:28:00.000Z')
    expect(shown).toMatch(/\d{2}\/\d{2}.*\d{2}:\d{2}/)
  })

  /** 采集时间可能为空或者脏，不能让表格里冒出 Invalid Date */
  it('空值或不合法的时间显示破折号', () => {
    expect(formatTime(null)).toBe('—')
    expect(formatTime(undefined)).toBe('—')
    expect(formatTime('')).toBe('—')
    expect(formatTime('不是时间')).toBe('—')
  })
})

describe('toSparklinePoints', () => {
  it('把数值铺满给定宽高', () => {
    const points = toSparklinePoints([0, 10], 100, 20)
    expect(points).toBe('0.0,20.0 100.0,0.0')
  })

  it('只有一个点时画一条中线', () => {
    expect(toSparklinePoints([5], 100, 20)).toBe('0,10 100,10')
  })

  /** 全都一样高时 span 是 0，除零会把整条线画飞 */
  it('数值全一样时画中线而不是 NaN', () => {
    const points = toSparklinePoints([7, 7, 7], 90, 20)
    expect(points).toBe('0.0,10.0 45.0,10.0 90.0,10.0')
    expect(points).not.toContain('NaN')
  })

  it('没有数据时返回空串', () => {
    expect(toSparklinePoints([], 100, 20)).toBe('')
  })
})
