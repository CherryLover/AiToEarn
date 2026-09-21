/**
 * UnmatchedRowsTable - 未归属的帖子
 *
 * 用户账号里的帖子远多于这个项目的：实测一个号 65 条，只有 3 条属于项目。
 * **不给 65 条全建发布记录**，其余留在这里，人一键认领到某条记录上。
 *
 * 「待定」（ambiguous）也列在这里：标题被平台截断、前缀撞上多条时系统不猜，
 * 数据照样存着，由人来定。
 */
'use client'

import type { CreatorNoteRow } from '@/api/creator-notes/creator-notes.types'
import type { PublishedPostListItem } from '@/api/publishing/publishing.types'
import { useState } from 'react'
import { METRIC_KEYS } from '@/api/creator-notes/creator-notes.constants'
import { MatchState } from '@/api/creator-notes/creator-notes.types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/utils/ui/toast'
import { formatMetric, formatTime, METRIC_LABELS } from './data.utils'

interface UnmatchedRowsTableProps {
  rows: CreatorNoteRow[]
  /** 能认领到的发布记录，只有这个项目的 */
  posts: PublishedPostListItem[]
  onClaim: (rowId: string, publishedPostId: string) => Promise<boolean>
}

export function UnmatchedRowsTable({ rows, posts, onClaim }: UnmatchedRowsTableProps) {
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const claim = async (rowId: string) => {
    const publishedPostId = picked[rowId]
    if (!publishedPostId) {
      toast.error('先选一条要认领到的发布记录')
      return
    }

    setClaimingId(rowId)
    try {
      if (await onClaim(rowId, publishedPostId))
        toast.success('认领成功，这条帖子的折线上已经有第一个点了')
      else
        toast.error('认领失败，刷新一下再试')
    }
    finally {
      setClaimingId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>发布时间</TableHead>
          {METRIC_KEYS.map(metric => (
            <TableHead key={metric} className="text-right">{METRIC_LABELS[metric]}</TableHead>
          ))}
          <TableHead>采集时间</TableHead>
          <TableHead className="w-[22rem]">认领到</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.id}>
            <TableCell className="max-w-[16rem]">
              <div className="truncate" title={row.title}>{row.title}</div>
              <div className="mt-1 flex gap-1">
                {row.titleTruncated && (
                  <Badge variant="outline" className="text-xs">标题被平台截断</Badge>
                )}
                {row.matchState === MatchState.Ambiguous && (
                  <Badge variant="secondary" className="text-xs">
                    {`前缀撞上 ${row.matchCandidates.length} 条，系统没猜`}
                  </Badge>
                )}
              </div>
            </TableCell>
            {/* 服务端解析不出来的时间留空，这里显示平台上的原文，不自己再猜一遍 */}
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {row.publishedAtText}
            </TableCell>
            {METRIC_KEYS.map(metric => (
              <TableCell key={metric} className="text-right tabular-nums">
                {formatMetric(row.metrics[metric])}
              </TableCell>
            ))}
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {formatTime(row.collectedAt)}
            </TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Select
                  value={picked[row.id] ?? ''}
                  onValueChange={value => setPicked(current => ({ ...current, [row.id]: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选一条发布记录" />
                  </SelectTrigger>
                  <SelectContent>
                    {posts.map(post => (
                      <SelectItem key={post.id} value={post.id}>
                        {post.title || post.draftPath}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={claimingId === row.id || posts.length === 0}
                  onClick={() => void claim(row.id)}
                >
                  认领
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
