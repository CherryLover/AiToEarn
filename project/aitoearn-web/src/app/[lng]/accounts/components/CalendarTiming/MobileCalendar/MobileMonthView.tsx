/**
 * MobileMonthView 组件
 *
 * 功能描述: 移动端日历月视图
 * - 紧凑型月历网格
 * - 选中日期高亮
 * - 点击日期切换选中
 */

'use client'

import type { IMobileMonthViewProps } from './mobileCalendar.types'
import dayjs from 'dayjs'
import { memo, useMemo } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { useGetClientLng } from '@/hooks/useSystem'
import { cn } from '@/utils/className'
import { getChinaCalendarLunarInfo } from '../calendarFestival.utils'
import CalendarLunarText from '../CalendarLunarText'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'

const MobileMonthView = memo<IMobileMonthViewProps>(
  ({ currentDate, selectedDate, recordMap, onDateSelect }) => {
    const { t } = useTransClient('common')
    const lng = useGetClientLng()

    // 星期标题 - 使用 i18n 翻译
    const weekDays = t('calendar.weekDaysShort', { returnObjects: true }) as string[]

    // 获取当月的日历网格（包含前后月份的填充日期）
    const calendarDates = useMemo(() => {
      const current = dayjs(currentDate)
      const startOfMonth = current.startOf('month')
      const endOfMonth = current.endOf('month')

      // 月初是星期几（0-6，0是周日）
      const startDayOfWeek = startOfMonth.day()

      // 上个月需要显示的天数
      const prevMonthDays = startDayOfWeek

      // 当月天数
      const daysInMonth = current.daysInMonth()

      // 下个月需要显示的天数（补齐到6行）
      const totalCells = 42 // 6行 * 7天
      const nextMonthDays = totalCells - prevMonthDays - daysInMonth

      const dates: { date: dayjs.Dayjs, isCurrentMonth: boolean }[] = []

      // 上个月的日期
      for (let i = prevMonthDays - 1; i >= 0; i--) {
        dates.push({
          date: startOfMonth.subtract(i + 1, 'day'),
          isCurrentMonth: false,
        })
      }

      // 当月的日期
      for (let i = 0; i < daysInMonth; i++) {
        dates.push({
          date: startOfMonth.add(i, 'day'),
          isCurrentMonth: true,
        })
      }

      // 下个月的日期
      for (let i = 0; i < nextMonthDays; i++) {
        dates.push({
          date: endOfMonth.add(i + 1, 'day'),
          isCurrentMonth: false,
        })
      }

      return dates
    }, [currentDate])

    // 今天的日期字符串
    const todayStr = dayjs().format('YYYY-MM-DD')

    // 选中日期字符串
    const selectedStr = dayjs(selectedDate).format('YYYY-MM-DD')

    return (
      <div className="px-4 py-3 bg-background">
        {/* 星期标题行 */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map((day, index) => (
            <div
              key={day}
              className={cn(
                'text-center text-xs text-muted-foreground',
                // 周末表头原来写死 text-red-400，压在页面底上只有 2.65:1（亮），正文门槛 4.5:1。
                // 站里唯一的红就是 destructive，换过来 5.32:1（亮）/ 7.02:1（暗）。
                // 同目录 MobileMonthView / MobileWeekView 两处一模一样，一起改。
                index === 0 && 'text-destructive', // 周日
                index === 6 && 'text-destructive', // 周六
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* 日期网格 */}
        <div className="grid grid-cols-7 gap-y-1">
          {calendarDates.map(({ date, isCurrentMonth }) => {
            const dateStr = date.format('YYYY-MM-DD')
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedStr
            const isPast = date.isBefore(dayjs(), 'day')
            const hasRecords = (recordMap.get(dateStr)?.length ?? 0) > 0
            const lunar = getChinaCalendarLunarInfo(date.toDate(), lng)

            return (
              <button
                key={dateStr}
                type="button"
                className={cn(
                  'relative flex min-h-14 flex-col items-center justify-center rounded-xl py-1.5 cursor-pointer transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  // 非当月日期：靠字重弱化，不再叠透明度（/40 实测只有 1.74:1）
                  !isCurrentMonth && 'text-muted-foreground',
                  // 当月日期样式
                  isCurrentMonth
                  && (isSelected
                    ? 'bg-gradient-back text-gradient-foreground shadow-md shadow-primary/20'
                    : isToday
                      ? 'bg-primary/10 text-primary font-bold'
                      : isPast
                        ? 'text-muted-foreground'
                        : 'text-foreground'),
                  !isSelected && 'hover:bg-accent',
                )}
                onClick={() => onDateSelect(date.toDate())}
              >
                {hasRecords && (
                  <span
                    className={cn(
                      'pointer-events-none absolute right-2 top-2 size-1.5 rounded-full shadow-sm',
                      isSelected ? 'bg-gradient-foreground/90' : 'bg-brand-cyan',
                    )}
                  />
                )}
                {/* 日期数字 */}
                <span
                  className={cn(
                    'text-sm tabular-nums',
                    isCurrentMonth ? 'font-semibold' : 'font-normal',
                  )}
                >
                  {date.date()}
                </span>
                <CalendarLunarText
                  lunar={lunar}
                  selected={isSelected}
                  compact
                  className={cn('mt-1 max-w-full px-1', isSelected && 'text-gradient-foreground/85')}
                />
              </button>
            )
          })}
        </div>
      </div>
    )
  },
)

MobileMonthView.displayName = 'MobileMonthView'

export default MobileMonthView
