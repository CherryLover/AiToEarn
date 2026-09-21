/**
 * useProjectMetrics - 项目下每条帖子的当前值 / 趋势，以及按方向的汇总
 *
 * 趋势和汇总都是服务端聚合出来的，不在浏览器里拿明细算：
 * 一条帖子每 3 小时一个采集点，把明细拉回来自己 reduce 就是把一整年的快照传到前端。
 */
'use client'

import type { AngleMetricTotal, PostMetricTrend } from '@/api/creator-notes/creator-notes.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getProjectAngleTotalsApi, getProjectMetricTrendsApi } from '@/api/creator-notes/creator-notes.api'

export function useProjectMetrics(projectId: string, days: number) {
  const [trends, setTrends] = useState<PostMetricTrend[]>([])
  const [angleTotals, setAngleTotals] = useState<AngleMetricTotal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!projectId)
      return

    setIsLoading(true)
    try {
      const [trendRes, totalRes] = await Promise.all([
        getProjectMetricTrendsApi(projectId, { days }),
        getProjectAngleTotalsApi(projectId, { days }),
      ])

      if (!mountedRef.current)
        return

      const ok = trendRes?.code === 0 && totalRes?.code === 0
      setTrends(Array.isArray(trendRes?.data) ? trendRes.data : [])
      setAngleTotals(Array.isArray(totalRes?.data) ? totalRes.data : [])
      setLoadFailed(!ok)
    }
    catch (error) {
      console.error('Load project metrics failed:', error)
      if (mountedRef.current) {
        setTrends([])
        setAngleTotals([])
        setLoadFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsLoading(false)
    }
  }, [projectId, days])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { trends, angleTotals, isLoading, loadFailed, refresh }
}
