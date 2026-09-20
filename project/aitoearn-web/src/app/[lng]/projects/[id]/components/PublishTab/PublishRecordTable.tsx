/**
 * PublishRecordTable - 已登记的发布记录
 * 平台、发布状态、链接状态、发布时间、链接。
 * 发布状态和链接状态分两列显示：「发出去了但没拿到链接」得一眼能看出来，不能合成一个。
 */
'use client'

import type { PublishedPostListItem } from '@/api/publishing/publishing.types'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/utils/className'
import { formatDate } from '@/utils/format'
import { getPlatformLabelKey } from './publish.utils'
import { LinkStatusBadge, PublishStatusBadge } from './PublishStatusBadges'

interface PublishRecordTableProps {
  posts: PublishedPostListItem[]
  total: number
  selectedId: string | null
  isLoading: boolean
  isLoadingMore: boolean
  loadFailed: boolean
  hasMore: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
  onLoadMore: () => void
}

/** 骨架屏占位 */
const SKELETON_KEYS = ['s1', 's2', 's3']

export function PublishRecordTable(props: PublishRecordTableProps) {
  const {
    posts,
    total,
    selectedId,
    isLoading,
    isLoadingMore,
    loadFailed,
    hasMore,
    onSelect,
    onRefresh,
    onLoadMore,
  } = props
  const { t } = useTransClient('projects')

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">
          {t('publish.records.title', { num: total })}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('action.refresh')}
          disabled={isLoading}
          onClick={onRefresh}
        >
          <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>

      {isLoading && posts.length === 0
        ? (
            <div className="flex flex-col gap-2 p-4">
              {SKELETON_KEYS.map(key => (
                <Skeleton key={key} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          )
        : loadFailed
          ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-foreground">{t('publish.records.loadFailed')}</p>
                <Button className="mt-4" variant="outline" onClick={onRefresh}>
                  <RefreshCw className="size-4" />
                  {t('action.retry')}
                </Button>
              </div>
            )
          : posts.length === 0
            ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {t('publish.records.empty')}
                </p>
              )
            : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('publish.records.platform')}</TableHead>
                        <TableHead>{t('publish.records.publishStatus')}</TableHead>
                        <TableHead>{t('publish.records.linkStatus')}</TableHead>
                        <TableHead>{t('publish.records.publishedAt')}</TableHead>
                        <TableHead>{t('publish.records.link')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {posts.map((post) => {
                        const platformLabelKey = getPlatformLabelKey(post.platform)

                        return (
                          <TableRow
                            key={post.id}
                            className={cn(
                              'cursor-pointer',
                              selectedId === post.id ? 'bg-accent/60' : undefined,
                            )}
                            onClick={() => onSelect(post.id)}
                          >
                            <TableCell>
                              <span className="text-sm text-foreground">
                                {platformLabelKey ? t(platformLabelKey) : post.platform}
                              </span>
                              {/* 标题是快照里的，列表直接有，不用再拉详情；鼠标停上去看来源草稿 */}
                              <span
                                className="mt-0.5 block max-w-[14rem] truncate text-xs text-muted-foreground"
                                title={post.draftPath}
                              >
                                {post.title || post.draftPath}
                              </span>
                            </TableCell>
                            <TableCell>
                              <PublishStatusBadge status={post.publishStatus} />
                            </TableCell>
                            <TableCell>
                              <LinkStatusBadge status={post.linkStatus} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {post.publishedAt
                                ? formatDate(post.publishedAt)
                                : t('publish.records.notPublishedYet')}
                            </TableCell>
                            <TableCell>
                              {post.postUrl
                                ? (
                                    <a
                                      href={post.postUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                                      onClick={event => event.stopPropagation()}
                                    >
                                      <ExternalLink className="size-3.5" />
                                      {t('publish.records.open')}
                                    </a>
                                  )
                                : (
                                    <span className="text-xs text-muted-foreground">
                                      {t('publish.records.noLink')}
                                    </span>
                                  )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>

                  {hasMore && (
                    <div className="flex justify-center border-t border-border px-4 py-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isLoadingMore}
                        onClick={onLoadMore}
                      >
                        {isLoadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                        {t('publish.records.loadMore')}
                      </Button>
                    </div>
                  )}
                </>
              )}
    </div>
  )
}
