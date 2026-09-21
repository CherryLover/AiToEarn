/**
 * 把卡片上的发布时间字符串解析成一个真实时刻。
 *
 * **插件不转时区，转换全在服务端**（contract-collect-xhs 第三节）：
 * 插件跑在用户的浏览器里，那台机器的时区是什么谁也不知道，在那边转等于把一个
 * 未知偏移写死进数据。页面上的时间是平台的本地时间，平台时区是已知常量，
 * 所以这里按平台时区解释那串字面量。
 *
 * **解析不了就返回 undefined，绝不退回「现在」**：退回现在的话，一条两个月前的帖子
 * 会被记成刚发的，而匹配规则第一条正是按「发布时间同一分钟」去找已知帖子的。
 */

/** `2026-09-18 08:28` / `2026-09-18 08:28:30` / `2026/09/18 08:28` */
const FULL_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
/** `09-18 08:28`：平台在同一年内常常省掉年份 */
const NO_YEAR_PATTERN = /^(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
/** `2026年9月18日 08:28` */
const CN_PATTERN = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function readWallClock(text: string, now: Date, timeZone: string): WallClock | null {
  const trimmed = text.trim()

  const full = FULL_PATTERN.exec(trimmed) ?? CN_PATTERN.exec(trimmed)
  if (full) {
    return {
      year: Number(full[1]),
      month: Number(full[2]),
      day: Number(full[3]),
      hour: Number(full[4]),
      minute: Number(full[5]),
      second: Number(full[6] ?? 0),
    }
  }

  const noYear = NO_YEAR_PATTERN.exec(trimmed)
  if (noYear) {
    // 省掉年份时按「平台时区的当前年份」补。跨年那几天会补错一年，
    // 补错了也只是匹配不上、落进未归属，不会把数据算到别的帖子头上
    return {
      year: currentYearIn(now, timeZone),
      month: Number(noYear[1]),
      day: Number(noYear[2]),
      hour: Number(noYear[3]),
      minute: Number(noYear[4]),
      second: Number(noYear[5] ?? 0),
    }
  }

  return null
}

function currentYearIn(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' })
  return Number(formatter.format(now))
}

/**
 * 这个时刻在目标时区里的挂钟时间，跟它在 UTC 下的挂钟时间差多少毫秒。
 *
 * 不写死 `+08:00` 是因为偏移是平台的属性，不该由这个函数假定；
 * 走 `Intl` 之后换个有夏令时的平台也不用改这里。
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = new Map(formatter.formatToParts(instant).map(part => [part.type, part.value]))
  const asUtc = Date.UTC(
    Number(parts.get('year')),
    Number(parts.get('month')) - 1,
    Number(parts.get('day')),
    // `hour12: false` 在部分实现里把午夜给成 24，归一成 0
    Number(parts.get('hour')) % 24,
    Number(parts.get('minute')),
    Number(parts.get('second')),
  )

  return asUtc - instant.getTime()
}

export function parsePlatformTime(text: string, timeZone: string, now: Date = new Date()): Date | undefined {
  const clock = readWallClock(text, now, timeZone)
  if (!clock)
    return undefined

  if (clock.month < 1 || clock.month > 12 || clock.day < 1 || clock.day > 31)
    return undefined

  if (clock.hour > 23 || clock.minute > 59 || clock.second > 59)
    return undefined

  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second)

  // 先按 UTC 当成一个猜测的时刻，量出那一刻的偏移再减掉。
  // 量一次就够：偏移只在夏令时切换的那一小时里不同，而那个窗口本来就没有唯一正确答案
  const guess = new Date(asUtc)
  const resolved = new Date(asUtc - zoneOffsetMs(guess, timeZone))

  return Number.isNaN(resolved.getTime()) ? undefined : resolved
}

/** 匹配用的「同一分钟」区间：卡片上只精确到分钟，秒是我们登记时自己记的 */
export function toMinuteRange(at: Date): { minuteStart: Date, minuteEnd: Date } {
  const minuteStart = new Date(at)
  minuteStart.setUTCSeconds(0, 0)
  return { minuteStart, minuteEnd: new Date(minuteStart.getTime() + 60_000) }
}
