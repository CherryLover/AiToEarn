/**
 * 卡片上的时间字符串怎么变成一个真实时刻。
 *
 * 这一步错了的后果是静默的：匹配规则第一条按「发布时间同一分钟」找已知帖子，
 * 时区差 8 小时的话每一条都匹配不上，页面上只会显示「未归属的帖子多了几十条」。
 */
import { describe, expect, it } from 'vitest'
import { parsePlatformTime, toMinuteRange } from './creator-note-time'

const XHS_ZONE = 'Asia/Shanghai'

describe('解析创作平台卡片上的发布时间', () => {
  it('实测格式：2026-09-18 08:28 按平台时区解释，不按服务器时区', () => {
    const at = parsePlatformTime('2026-09-18 08:28', XHS_ZONE)

    // 东八区 08:28 就是 UTC 00:28。服务器在哪个时区都该算出这个值
    expect(at?.toISOString()).toBe('2026-09-18T00:28:00.000Z')
  })

  it('带秒、斜杠分隔、中文年月日都认', () => {
    expect(parsePlatformTime('2026-09-18 08:28:30', XHS_ZONE)?.toISOString())
      .toBe('2026-09-18T00:28:30.000Z')
    expect(parsePlatformTime('2026/09/18 08:28', XHS_ZONE)?.toISOString())
      .toBe('2026-09-18T00:28:00.000Z')
    expect(parsePlatformTime('2026年9月18日 08:28', XHS_ZONE)?.toISOString())
      .toBe('2026-09-18T00:28:00.000Z')
  })

  it('省掉年份的按「平台时区的当前年份」补', () => {
    const now = new Date('2026-09-21T00:00:00.000Z')
    expect(parsePlatformTime('09-18 08:28', XHS_ZONE, now)?.toISOString())
      .toBe('2026-09-18T00:28:00.000Z')
  })

  /**
   * 退回「现在」的话，一条两个月前的帖子会被记成刚发的，
   * 而匹配第一条规则正是按发布时间去找已知帖子的——会匹配到完全不相干的帖子上。
   */
  it('解析不了返回 undefined，绝不退回「现在」', () => {
    expect(parsePlatformTime('昨天 08:28', XHS_ZONE)).toBeUndefined()
    expect(parsePlatformTime('', XHS_ZONE)).toBeUndefined()
    expect(parsePlatformTime('2026-13-45 99:99', XHS_ZONE)).toBeUndefined()
    expect(parsePlatformTime('刚刚', XHS_ZONE)).toBeUndefined()
  })

  it('跨时区的平台走同一套，不写死 +08:00', () => {
    // 2026-09-18 是美东夏令时，UTC-4
    expect(parsePlatformTime('2026-09-18 08:28', 'America/New_York')?.toISOString())
      .toBe('2026-09-18T12:28:00.000Z')
    // 1 月是标准时，UTC-5：同一个函数要能给出不同的偏移
    expect(parsePlatformTime('2026-01-18 08:28', 'America/New_York')?.toISOString())
      .toBe('2026-01-18T13:28:00.000Z')
  })
})

describe('同一分钟的区间', () => {
  it('把秒抹掉，区间是左闭右开的一分钟', () => {
    const { minuteStart, minuteEnd } = toMinuteRange(new Date('2026-09-18T00:28:47.123Z'))

    expect(minuteStart.toISOString()).toBe('2026-09-18T00:28:00.000Z')
    expect(minuteEnd.toISOString()).toBe('2026-09-18T00:29:00.000Z')
  })
})
