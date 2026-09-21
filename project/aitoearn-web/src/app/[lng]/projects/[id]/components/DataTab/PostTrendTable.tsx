/**
 * PostTrendTable - 每条帖子一行：五个指标的当前值和跟上一次采集的变化
 *
 * 点开一行看时间序列，那几次快照连成一条折线。折线是按需拉的：
 * 一个项目里几十条帖子，进页面就把每条的完整序列都拉回来，
 * 换来的只是一屏根本看不过来的小图。
 */
'use client'

import type { PostMetricPoint, PostMetricTrend } from '@/api/creator-notes/creator-notes.types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useCallback, useState } from 'react'
import { getPostMetricSeriesApi } from '@/api/creator-notes/creator-notes.api'
import { METRIC_KEYS } from '@/api/creator-notes/creator-notes.constants'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  deltaTone,
  formatDelta,
  formatMetric,
  formatTime,
  METRIC_LABELS,
  toSparklinePoints,
} from './data.utils'

const SPARKLINE_WIDTH = 120
const SPARKLINE_HEIGHT = 28

interface PostTrendTableProps {
  trends: PostMetricTrend[]
  /** 发布记录 id -> 标题，取不到就显示 id */
  postTitles: Map<string, string>
}

export function PostTrendTable({ trends, postTitles }: PostTrendTableProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [series, setSeries] = useState<Record<string, PostMetricPoint[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const toggle = useCallback(
    async (publishedPostId: string) => {
      if (openId === publishedPostId) {
        setOpenId(null)
        return
      }

      setOpenId(publishedPostId)
      if (series[publishedPostId])
        return

      setLoadingId(publishedPostId)
      try {
        const res = await getPostMetricSeriesApi(publishedPostId)
        const list = res?.code === 0 && Array.isArray(res.data) ? res.data : []
        setSeries(current => ({ ...current, [publishedPostId]: list }))
      }
      catch (error) {
        console.error('Load post metric series failed:', error)
        setSeries(current => ({ ...current, [publishedPostId]: [] }))
      }
      finally {
        setLoadingId(null)
      }
    },
    [openId, series],
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>标题</TableHead>
          {METRIC_KEYS.map(metric => (
            <TableHead key={metric} className="text-right">{METRIC_LABELS[metric]}</TableHead>
          ))}
          <TableHead className="text-right">最近采集</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trends.map((trend) => {
          const title = postTitles.get(trend.publishedPostId) ?? trend.publishedPostId
          const isOpen = openId === trend.publishedPostId
          const points = series[trend.publishedPostId]

          return (
            <Fragment key={trend.publishedPostId}>
              <TableRow>
                <TableCell className="p-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => void toggle(trend.publishedPostId)}
                    aria-label={isOpen ? '收起时间序列' : '展开时间序列'}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </TableCell>
                <TableCell className="max-w-[18rem] truncate" title={title}>{title}</TableCell>
                {METRIC_KEYS.map(metric => (
                  <TableCell key={metric} className="text-right tabular-nums">
                    <div>{formatMetric(trend.latest[metric])}</div>
                    {/* 只采过一次的帖子没有对比值，写「首次」比写 +0 诚实 */}
                    <div className={`text-xs ${trend.delta ? deltaTone(trend.delta[metric]) : 'text-muted-foreground'}`}>
                      {trend.delta ? formatDelta(trend.delta[metric]) : '首次'}
                    </div>
                  </TableCell>
                ))}
                <TableCell className="text-right text-xs text-muted-foreground">
                  {formatTime(trend.latestCollectedAt)}
                </TableCell>
              </TableRow>

              {isOpen && (
                <TableRow>
                  <TableCell colSpan={METRIC_KEYS.length + 3} className="bg-muted/30">
                    {loadingId === trend.publishedPostId && (
                      <div className="py-3 text-sm text-muted-foreground">正在拉时间序列…</div>
                    )}
                    {loadingId !== trend.publishedPostId && (!points || points.length === 0) && (
                      <div className="py-3 text-sm text-muted-foreground">还没有快照。采集一次之后这里就会有点。</div>
                    )}
                    {loadingId !== trend.publishedPostId && points && points.length > 0 && (
                      <div className="flex flex-wrap gap-6 py-3">
                        {METRIC_KEYS.map((metric) => {
                          const values = points.map(point => point.metrics[metric])
                          return (
                            <div key={metric}>
                              <div className="mb-1 text-xs text-muted-foreground">
                                {METRIC_LABELS[metric]}
                                {' · '}
                                {points.length}
                                {' 个点'}
                              </div>
                              <svg
                                width={SPARKLINE_WIDTH}
                                height={SPARKLINE_HEIGHT}
                                viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                                role="img"
                                aria-label={`${METRIC_LABELS[metric]}走势`}
                              >
                                <polyline
                                  points={toSparklinePoints(values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT)}
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.5}
                                  className="text-primary"
                                />
                              </svg>
                              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                                {formatTime(points[0]?.collectedAt)}
                                {' → '}
                                {formatTime(points[points.length - 1]?.collectedAt)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
