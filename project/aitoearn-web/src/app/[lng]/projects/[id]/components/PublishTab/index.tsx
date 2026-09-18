/**
 * PublishTab - 项目详情页「发布」标签页
 * 选一份草稿打包成发布卡片，复制内容、下载配图、去平台自己发，发完回来把链接填上。
 *
 * 这一轮只做到「把内容打包好给人看」为止：页面上没有任何自动发布的入口，
 * 也不调用任何平台的发布接口。自动发布是浏览器插件那条线的事。
 */
'use client'

import type { PublishedPostDetail } from '@/api/publishing/publishing.types'
import { Hand } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPublishedPostDetailApi } from '@/api/publishing/publishing.api'
import { useTransClient } from '@/app/i18n/client'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/utils/ui/toast'
import { useDrafts } from '../DraftsTab/useDrafts'
import { PreparePublishPanel } from './PreparePublishPanel'
import { getPublishErrorKey } from './publish.utils'
import { PublishCard } from './PublishCard'
import { PublishRecordTable } from './PublishRecordTable'
import { usePublishedPosts } from './usePublishedPosts'

interface PublishTabProps {
  projectId: string
  /** 归档项目只读 */
  readOnly: boolean
}

export function PublishTab({ projectId, readOnly }: PublishTabProps) {
  const { t } = useTransClient('projects')

  const { drafts, isLoading: isDraftsLoading } = useDrafts(projectId)
  const {
    posts,
    total,
    isLoading,
    isLoadingMore,
    loadFailed,
    hasMore,
    refresh,
    loadMore,
  } = usePublishedPosts(projectId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PublishedPostDetail | null>(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)

  // 切记录时旧请求的回包要丢掉
  const detailTokenRef = useRef(0)

  const loadDetail = useCallback(
    async (id: string) => {
      detailTokenRef.current += 1
      const token = detailTokenRef.current

      setIsDetailLoading(true)
      try {
        const res = await getPublishedPostDetailApi(projectId, id)
        if (detailTokenRef.current !== token)
          return

        if (res && res.code === 0 && res.data) {
          setDetail(res.data)
          return
        }

        setDetail(null)
        toast.error(t(getPublishErrorKey(res?.code)))
      }
      catch (error) {
        console.error('Load published post detail failed:', error)
        if (detailTokenRef.current === token) {
          setDetail(null)
          toast.error(t('error.network'))
        }
      }
      finally {
        if (detailTokenRef.current === token)
          setIsDetailLoading(false)
      }
    },
    [projectId, t],
  )

  // 选中哪条就看哪条的完整快照；刚建出来或刚更新过的那条已经在手上，不用再拉一次
  useEffect(() => {
    if (!selectedId || detail?.id === selectedId)
      return

    loadDetail(selectedId)
  }, [detail?.id, loadDetail, selectedId])

  const handleCreated = (post: PublishedPostDetail) => {
    setDetail(post)
    setSelectedId(post.id)
    refresh()
  }

  const handleUpdated = (post: PublishedPostDetail) => {
    setDetail(post)
    setSelectedId(post.id)
    refresh()
  }

  const handleDeleted = () => {
    setDetail(null)
    setSelectedId(null)
    refresh()
  }

  const isEmpty = !isLoading && !loadFailed && posts.length === 0

  return (
    <div className="mt-4 flex flex-col gap-4">
      <PreparePublishPanel
        projectId={projectId}
        drafts={drafts}
        isDraftsLoading={isDraftsLoading}
        readOnly={readOnly}
        onCreated={handleCreated}
      />

      {/* 选中的那条，完整卡片 */}
      {selectedId && (
        isDetailLoading && detail?.id !== selectedId
          ? <Skeleton className="h-96 w-full rounded-xl" />
          : detail
            ? (
                <PublishCard
                  key={detail.id}
                  projectId={projectId}
                  post={detail}
                  readOnly={readOnly}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              )
            : null
      )}

      {isEmpty
        ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
              <Hand className="mb-3 size-6 text-muted-foreground" />
              <h3 className="text-base font-medium text-foreground">{t('publish.empty.title')}</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                {t('publish.empty.desc')}
              </p>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                {t('publish.empty.notAuto')}
              </p>
            </div>
          )
        : (
            <PublishRecordTable
              posts={posts}
              total={total}
              selectedId={selectedId}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              loadFailed={loadFailed}
              hasMore={hasMore}
              onSelect={setSelectedId}
              onRefresh={refresh}
              onLoadMore={loadMore}
            />
          )}
    </div>
  )
}
