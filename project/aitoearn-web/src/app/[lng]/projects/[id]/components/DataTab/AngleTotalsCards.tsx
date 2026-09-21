/**
 * AngleTotalsCards - 按方向汇总
 *
 * **这才是整套采集设计的目的**：单条帖子涨了多少只是噪音，
 * 「这个方向下的所有帖子加起来表现如何」才是能拿来改选题的判断。
 *
 * 每条帖子取的是它最新那一条快照再相加。累加所有快照会得到一个
 * 既不是当前值也不是增量的数，那个聚合在服务端就做掉了。
 */
'use client'

import type { AngleMetricTotal } from '@/api/creator-notes/creator-notes.types'
import { METRIC_KEYS } from '@/api/creator-notes/creator-notes.constants'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMetric, METRIC_LABELS } from './data.utils'

interface AngleTotalsCardsProps {
  totals: AngleMetricTotal[]
  /** 方向 id -> 方向名，取不到就显示 id */
  angleNames: Map<string, string>
}

export function AngleTotalsCards({ totals, angleNames }: AngleTotalsCardsProps) {
  if (totals.length === 0)
    return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {totals.map((total) => {
        const key = total.angleId ?? '__none__'
        const name = total.angleId
          ? angleNames.get(total.angleId) ?? total.angleId
          : '没挂方向'

        return (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span className="truncate" title={name}>{name}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {total.postCount}
                  {' '}
                  条帖子
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-5 gap-2 text-center">
                {METRIC_KEYS.map(metric => (
                  <div key={metric}>
                    <dt className="text-xs text-muted-foreground">{METRIC_LABELS[metric]}</dt>
                    <dd className="mt-0.5 text-sm font-medium tabular-nums">
                      {formatMetric(total.totals[metric])}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
