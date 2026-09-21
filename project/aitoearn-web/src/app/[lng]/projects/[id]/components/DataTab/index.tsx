/**
 * DataTab - 项目详情页「数据」标签页
 *
 * 数据是浏览器插件从创作平台的作品列表页读回来的（contract-collect-xhs）：
 * 每 3 小时自动采一次，回报后服务端按「标题 + 发布时间」归到发布记录上。
 * 这一页只负责把归好的数据摆出来，以及让人认领系统没敢猜的那些。
 *
 * 页面上没有任何「填数据」的入口：数字全部来自采集，手填的数没法比较。
 */
'use client'

import type { PublishedPostListItem } from '@/api/publishing/publishing.types'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAngleListApi } from '@/api/angles/angle.api'
import { createSyncTaskApi } from '@/api/creator-notes/creator-notes.api'
import { COLLECT_PLATFORMS } from '@/api/creator-notes/creator-notes.constants'
import { getPublishedPostListApi } from '@/api/publishing/publishing.api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/utils/ui/toast'
import { AngleTotalsCards } from './AngleTotalsCards'
import { PostTrendTable } from './PostTrendTable'
import { UnmatchedRowsTable } from './UnmatchedRowsTable'
import { useProjectMetrics } from './useProjectMetrics'
import { useUnmatchedRows } from './useUnmatchedRows'

/** 聚合窗口：往回看多少天。不是展示过滤，是给服务端聚合兜底的窗口 */
const TREND_DAYS = 30
/** 认领下拉里能选的发布记录条数，够用就行 */
const CLAIMABLE_POSTS_PAGE_SIZE = 200

interface DataTabProps {
  projectId: string
  /** 归档项目只读 */
  readOnly: boolean
}

export function DataTab({ projectId, readOnly }: DataTabProps) {
  const { trends, angleTotals, isLoading, loadFailed, refresh } = useProjectMetrics(projectId, TREND_DAYS)
  const { rows, total: unmatchedTotal, isLoading: isRowsLoading, refresh: refreshRows, claim } = useUnmatchedRows()

  const [posts, setPosts] = useState<PublishedPostListItem[]>([])
  const [angleNames, setAngleNames] = useState<Map<string, string>>(new Map())
  const [isSyncing, setIsSyncing] = useState(false)

  // 趋势接口只给 publishedPostId 和数字，标题和方向名要从各自的列表里对出来
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [postRes, angleRes] = await Promise.all([
          getPublishedPostListApi(projectId, { page: 1, pageSize: CLAIMABLE_POSTS_PAGE_SIZE }),
          getAngleListApi(projectId),
        ])

        if (cancelled)
          return

        setPosts(Array.isArray(postRes?.data?.list) ? postRes.data.list : [])
        const angles = Array.isArray(angleRes?.data) ? angleRes.data : []
        setAngleNames(new Map(angles.map(angle => [angle.id, angle.name || angle.slug])))
      }
      catch (error) {
        console.error('Load posts or angles for data tab failed:', error)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const postTitles = useMemo(
    () => new Map(posts.map(post => [post.id, post.title || post.draftPath])),
    [posts],
  )

  const syncNow = useCallback(async () => {
    setIsSyncing(true)
    try {
      const res = await createSyncTaskApi({ platform: COLLECT_PLATFORMS[0], projectId })
      if (res?.code === 0) {
        toast.success('已经派给你那台装了插件的机器，跑完刷新一下就能看到新数据')
        return
      }

      // 最常见的两种：名下没有声明了这个平台的机器，或者插件版本还不会干这活
      toast.error(res?.message || '建采集工单失败')
    }
    catch (error) {
      console.error('Create sync task failed:', error)
      toast.error('建采集工单失败')
    }
    finally {
      setIsSyncing(false)
    }
  }, [projectId])

  const refreshAll = useCallback(() => {
    void refresh()
    void refreshRows()
  }, [refresh, refreshRows])

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {`数据来自浏览器插件每 3 小时采一次的创作平台作品列表，看的是最近 ${TREND_DAYS} 天。`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
          {!readOnly && (
            <Button size="sm" disabled={isSyncing} onClick={() => void syncNow()}>
              {isSyncing ? '正在派单…' : '立刻采一次'}
            </Button>
          )}
        </div>
      </div>

      {loadFailed && (
        <div className="rounded-xl border border-dashed border-border px-6 py-6 text-center text-sm text-muted-foreground">
          数据加载失败，刷新一下再试。
        </div>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-medium">按方向汇总</h3>
        {angleTotals.length === 0
          ? (
              <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
                还没有归属到这个项目的数据。先采一次，或者在下面把属于这个项目的帖子认领过来。
              </div>
            )
          : <AngleTotalsCards totals={angleTotals} angleNames={angleNames} />}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          每条帖子
          <span className="ml-2 text-xs font-normal text-muted-foreground">点开看时间序列</span>
        </h3>
        {trends.length === 0
          ? (
              <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
                这个窗口里还没有快照。
              </div>
            )
          : <PostTrendTable trends={trends} postTitles={postTitles} />}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          未归属的帖子
          {unmatchedTotal > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {`共 ${unmatchedTotal} 条`}
            </span>
          )}
        </h3>
        <p className="text-xs text-muted-foreground">
          账号里的帖子远多于这个项目的，系统只给匹配上已知帖子或草稿的建记录。其余留在这里，属于这个项目的可以认领过来。
        </p>
        {isRowsLoading
          ? <Skeleton className="h-32 w-full" />
          : rows.length === 0
            ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
                  没有待认领的帖子。
                </div>
              )
            : <UnmatchedRowsTable rows={rows} posts={posts} onClaim={claim} />}
      </section>
    </div>
  )
}
