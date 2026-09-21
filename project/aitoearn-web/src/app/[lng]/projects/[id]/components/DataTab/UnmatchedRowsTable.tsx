/**
 * UnmatchedRowsTable - 未归属的帖子
 *
 * 用户账号里的帖子远多于这个项目的：实测一个号 65 条，只有 3 条属于项目。
 * **不给 65 条全建发布记录**，其余留在这里，由人来处理，有两条出路：
 *
 * - **认领**到一条已有的发布记录上（这条内容当初是走系统发的）
 * - **建成新记录**（这条内容是自己做的，一开始没走系统，现在要并进来）
 *
 * 「待定」（ambiguous）也列在这里：标题被平台截断、前缀撞上多条时系统不猜，
 * 数据照样存着，由人来定。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import type { AdoptCreatorNoteRowParams, CreatorNoteRow } from '@/api/creator-notes/creator-notes.types'
import type { PublishedPostListItem } from '@/api/publishing/publishing.types'
import { useState } from 'react'
import { METRIC_KEYS } from '@/api/creator-notes/creator-notes.constants'
import { MatchState } from '@/api/creator-notes/creator-notes.types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

/** 「不挂方向」在下拉里的取值：Select 不接受空字符串作为选项值 */
const NO_ANGLE = '__none__'

interface UnmatchedRowsTableProps {
  rows: CreatorNoteRow[]
  /** 能认领到的发布记录，只有这个项目的 */
  posts: PublishedPostListItem[]
  /** 建新记录时能挂的方向 */
  angles: Angle[]
  onClaim: (rowId: string, publishedPostId: string) => Promise<boolean>
  /** projectId 由外层补，这里只决定挂哪个方向 */
  onAdopt: (rowId: string, params: Omit<AdoptCreatorNoteRowParams, 'projectId'>) => Promise<boolean>
  /** 归档项目只读 */
  readOnly: boolean
}

export function UnmatchedRowsTable({ rows, posts, angles, onClaim, onAdopt, readOnly }: UnmatchedRowsTableProps) {
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adopting, setAdopting] = useState<CreatorNoteRow | null>(null)
  const [adoptAngleId, setAdoptAngleId] = useState<string>(NO_ANGLE)

  const claim = async (rowId: string) => {
    const publishedPostId = picked[rowId]
    if (!publishedPostId) {
      toast.error('先选一条要认领到的发布记录')
      return
    }

    setBusyId(rowId)
    try {
      if (await onClaim(rowId, publishedPostId))
        toast.success('认领成功，这条帖子的折线上已经有第一个点了')
      else
        toast.error('认领失败，刷新一下再试')
    }
    finally {
      setBusyId(null)
    }
  }

  const adopt = async () => {
    if (!adopting)
      return

    setBusyId(adopting.id)
    try {
      const ok = await onAdopt(adopting.id, {
        angleId: adoptAngleId === NO_ANGLE ? undefined : adoptAngleId,
      })

      if (ok) {
        toast.success('已经建成一条发布记录，从现在起它的数据会算进这个项目')
        setAdopting(null)
        return
      }

      toast.error('建记录失败，刷新一下再试')
    }
    finally {
      setBusyId(null)
    }
  }

  const openAdopt = (row: CreatorNoteRow) => {
    setAdoptAngleId(NO_ANGLE)
    setAdopting(row)
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead>发布时间</TableHead>
            {METRIC_KEYS.map(metric => (
              <TableHead key={metric} className="text-right">{METRIC_LABELS[metric]}</TableHead>
            ))}
            <TableHead>采集时间</TableHead>
            <TableHead className="w-[26rem]">归到哪里</TableHead>
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
                    disabled={readOnly}
                    onValueChange={value => setPicked(current => ({ ...current, [row.id]: value }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="认领到已有记录" />
                    </SelectTrigger>
                    <SelectContent>
                      {posts.map(post => (
                        <SelectItem key={post.id} value={post.id}>
                          {post.title || post.draftPath || post.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly || busyId === row.id || posts.length === 0}
                    onClick={() => void claim(row.id)}
                  >
                    认领
                  </Button>
                  <Button
                    size="sm"
                    className="whitespace-nowrap"
                    disabled={readOnly || busyId === row.id}
                    onClick={() => openAdopt(row)}
                  >
                    建成新记录
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={adopting !== null} onOpenChange={open => !open && setAdopting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>建成这个项目的一条发布记录</DialogTitle>
            <DialogDescription>
              平台的作品列表页上只有标题、发布时间和五个数字，没有正文，所以建出来的记录正文是空的。
              建完之后这条帖子的数据就会算进这个项目，也会按你选的方向汇总。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">标题</div>
              <div className="text-sm">{adopting?.title}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">发布时间</div>
              <div className="text-sm">{adopting?.publishedAtText}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">挂到哪个方向</div>
              <Select value={adoptAngleId} onValueChange={setAdoptAngleId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ANGLE}>不挂方向</SelectItem>
                  {angles.map(angle => (
                    <SelectItem key={angle.id} value={angle.id}>
                      {angle.name || angle.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdopting(null)}>取消</Button>
            <Button disabled={busyId === adopting?.id} onClick={() => void adopt()}>
              建记录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
