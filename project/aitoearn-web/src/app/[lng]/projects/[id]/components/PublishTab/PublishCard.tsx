/**
 * PublishCard - 一条待发内容的打包卡片
 * 标题、正文、话题各有各的复制按钮，图片能单张或整批下载，再给一个平台创作后台的入口。
 *
 * 这张卡片就是这一轮的全部：把内容打包好交给人，人自己去平台发。
 * 页面上没有、也不许加「一键自动发布」——那是插件那条线的事。
 * 发完回来把帖子链接填进去，这条记录才转成已发布。
 */
'use client'

import type { PublishedPostDetail } from '@/api/publishing/publishing.types'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  ImageOff,
  Loader2,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import {
  completePublishedPostApi,
  deletePublishedPostApi,
  failPublishedPostApi,
} from '@/api/publishing/publishing.api'
import {
  PLATFORM_POST_ID_MAX_LENGTH,
  POST_URL_MAX_LENGTH,
  PUBLISH_FAIL_REASON_MAX_LENGTH,
} from '@/api/publishing/publishing.constants'
import { PublishStatus } from '@/api/publishing/publishing.types'
import { useTransClient } from '@/app/i18n/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDate } from '@/utils/format'
import { toast } from '@/utils/ui/toast'
import { CopyButton } from './CopyButton'
import {
  BATCH_DOWNLOAD_GAP_MS,
  BODY_COLLAPSE_MIN_LENGTH,
  PLATFORM_CREATOR_URL,
} from './publish.constants'
import {
  buildFullCopyText,
  buildImageFileName,
  downloadImage,
  formatTopics,
  getPlatformLabelKey,
  getPublishErrorKey,
  validatePostUrl,
} from './publish.utils'
import { LinkStatusBadge, PublishStatusBadge } from './PublishStatusBadges'

interface PublishCardProps {
  projectId: string
  post: PublishedPostDetail
  /** 归档项目只读 */
  readOnly: boolean
  /** 回填 / 标失败之后把最新记录交回上层 */
  onUpdated: (post: PublishedPostDetail) => void
  /** 删除之后让上层收起卡片并刷新列表 */
  onDeleted: (id: string) => void
}

export function PublishCard({ projectId, post, readOnly, onUpdated, onDeleted }: PublishCardProps) {
  const { t } = useTransClient('projects')

  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [postUrl, setPostUrl] = useState(post.postUrl ?? '')
  const [platformPostId, setPlatformPostId] = useState(post.platformPostId ?? '')
  const [urlErrorKey, setUrlErrorKey] = useState<string | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  const [failOpen, setFailOpen] = useState(false)
  const [failReason, setFailReason] = useState('')
  const [isFailing, setIsFailing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)

  const snapshot = post.snapshot
  const topicsText = formatTopics(snapshot?.topics ?? [])
  const bodyText = snapshot?.body ?? ''
  const mediaUrls = snapshot?.mediaUrls ?? []
  const fullText = snapshot ? buildFullCopyText(snapshot) : ''
  const canCollapseBody = bodyText.length > BODY_COLLAPSE_MIN_LENGTH

  const platformLabelKey = getPlatformLabelKey(post.platform)
  const platformLabel = platformLabelKey ? t(platformLabelKey) : post.platform
  const creatorUrl = PLATFORM_CREATOR_URL[post.platform] ?? ''
  const isPublished = post.publishStatus === PublishStatus.Published

  const handleDownloadOne = async (url: string, index: number) => {
    const ok = await downloadImage(url, buildImageFileName(url, index))
    if (!ok)
      toast.warning(t('publish.card.downloadFallback'))
  }

  const handleDownloadAll = async () => {
    if (downloadingAll || mediaUrls.length === 0)
      return

    setDownloadingAll(true)
    try {
      let fallbackCount = 0
      for (let index = 0; index < mediaUrls.length; index += 1) {
        const ok = await downloadImage(mediaUrls[index], buildImageFileName(mediaUrls[index], index))
        if (!ok)
          fallbackCount += 1

        // 连着触发下载会被浏览器拦，隔一小会儿再来下一张
        if (index < mediaUrls.length - 1)
          await new Promise(resolve => setTimeout(resolve, BATCH_DOWNLOAD_GAP_MS))
      }

      if (fallbackCount > 0)
        toast.warning(t('publish.card.downloadFallback'))
      else
        toast.success(t('publish.card.downloadStarted'))
    }
    finally {
      setDownloadingAll(false)
    }
  }

  const handleComplete = async () => {
    if (readOnly || isCompleting)
      return

    const errorKey = validatePostUrl(postUrl)
    if (errorKey) {
      setUrlErrorKey(errorKey)
      return
    }

    setUrlErrorKey(null)
    setIsCompleting(true)
    try {
      const res = await completePublishedPostApi(projectId, post.id, {
        postUrl: postUrl.trim(),
        platformPostId: platformPostId.trim() || undefined,
      })

      if (res && res.code === 0 && res.data) {
        toast.success(t('publish.card.completeSuccess'))
        onUpdated(res.data)
        return
      }

      toast.error(t(getPublishErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Complete published post failed:', error)
      toast.error(t('error.network'))
    }
    finally {
      setIsCompleting(false)
    }
  }

  const handleFail = async () => {
    if (readOnly || isFailing || !failReason.trim())
      return

    setIsFailing(true)
    try {
      const res = await failPublishedPostApi(projectId, post.id, {
        reason: failReason.trim(),
      })

      if (res && res.code === 0 && res.data) {
        toast.success(t('publish.card.failMarked'))
        setFailOpen(false)
        setFailReason('')
        onUpdated(res.data)
        return
      }

      toast.error(t(getPublishErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Mark published post failed:', error)
      toast.error(t('error.network'))
    }
    finally {
      setIsFailing(false)
    }
  }

  const handleDelete = async () => {
    if (readOnly || isDeleting)
      return

    setIsDeleting(true)
    try {
      const res = await deletePublishedPostApi(projectId, post.id)
      if (res && res.code === 0) {
        toast.success(t('publish.card.deleted'))
        setDeleteOpen(false)
        onDeleted(post.id)
        return
      }

      toast.error(t(getPublishErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Delete published post failed:', error)
      toast.error(t('error.network'))
    }
    finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* 头：平台、两个状态、来源草稿 */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{platformLabel}</h3>
            <PublishStatusBadge status={post.publishStatus} />
            <LinkStatusBadge status={post.linkStatus} />
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{post.draftPath}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {creatorUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={creatorUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                {t('publish.card.openPlatform')}
              </a>
            </Button>
          )}
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('publish.card.delete')}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 这一步在干什么：内容打包好了，发是你自己去发 */}
      {!isPublished && (
        <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {t('publish.card.manualTip')}
        </p>
      )}

      {/* 上次自己标的失败原因，留着好回看 */}
      {post.publishStatus === PublishStatus.Failed && post.failReason && (
        <p className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {t('publish.card.failReason', { reason: post.failReason })}
        </p>
      )}

      <div className="flex flex-col gap-4 p-4">
        {/* 标题 */}
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">{t('publish.card.titleLabel')}</Label>
            <CopyButton text={snapshot?.title ?? ''} label={t('publish.card.copy')} />
          </div>
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            {snapshot?.title || t('publish.card.emptyField')}
          </p>
        </section>

        {/* 正文 */}
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">{t('publish.card.bodyLabel')}</Label>
            <div className="flex items-center gap-2">
              {canCollapseBody && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setBodyExpanded(prev => !prev)}
                >
                  {bodyExpanded ? t('publish.card.collapse') : t('publish.card.expand')}
                </Button>
              )}
              <CopyButton text={bodyText} label={t('publish.card.copy')} />
            </div>
          </div>
          {/* 折叠时切掉多余的，不做内部滚动：鼠标停在正文上滚页面才不会被卡住 */}
          <pre
            className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground${
              canCollapseBody && !bodyExpanded ? ' max-h-48 overflow-hidden' : ''
            }`}
          >
            {bodyText || t('publish.card.emptyField')}
          </pre>
        </section>

        {/* 话题 */}
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">{t('publish.card.topicsLabel')}</Label>
            <CopyButton text={topicsText} label={t('publish.card.copy')} />
          </div>
          {snapshot?.topics?.length
            ? (
                <div className="flex flex-wrap gap-1.5">
                  {snapshot.topics.map(topic => (
                    <span
                      key={topic}
                      className="rounded-md bg-accent px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {topic.startsWith('#') ? topic : `#${topic}`}
                    </span>
                  ))}
                </div>
              )
            : (
                <p className="text-sm text-muted-foreground/70">{t('publish.card.emptyField')}</p>
              )}
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            text={fullText}
            label={t('publish.card.copyAll')}
            variant="default"
            size="default"
          />
          <span className="text-xs text-muted-foreground">{t('publish.card.copyAllHint')}</span>
        </div>

        {/* 配图 */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              {t('publish.card.mediaLabel')}
              {mediaUrls.length > 0 ? ` (${mediaUrls.length})` : ''}
            </Label>
            {mediaUrls.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={downloadingAll}
                onClick={handleDownloadAll}
              >
                {downloadingAll
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Download className="size-4" />}
                {t('publish.card.downloadAll')}
              </Button>
            )}
          </div>

          {mediaUrls.length === 0
            ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-8 text-center">
                  <ImageOff className="mb-2 size-5 text-muted-foreground" />
                  <p className="text-sm text-foreground">{t('publish.card.noMedia')}</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    {t('publish.card.noMediaHint')}
                  </p>
                </div>
              )
            : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {mediaUrls.map((url, index) => (
                    <figure
                      key={url}
                      className="overflow-hidden rounded-lg border border-border bg-muted/30"
                    >
                      {/* 快照里的图片是 OSS 外链，不走 next/image 的域名白名单那套 */}
                      {/* eslint-disable-next-line next/no-img-element */}
                      <img src={url} alt={buildImageFileName(url, index)} className="h-32 w-full object-cover" />
                      <figcaption className="flex items-center justify-between gap-1 px-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-muted-foreground">
                          {buildImageFileName(url, index)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label={t('publish.card.download')}
                          onClick={() => handleDownloadOne(url, index)}
                        >
                          <Download className="size-4" />
                        </Button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
        </section>

        {/* 发完回来登记 */}
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-foreground">{t('publish.card.registerTitle')}</h4>
            {isPublished && post.publishedAt && (
              <span className="text-xs text-muted-foreground">
                {t('publish.card.publishedAt', { time: formatDate(post.publishedAt) })}
              </span>
            )}
          </div>

          {isPublished
            ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">{t('publish.card.registeredHint')}</p>
                  {post.postUrl && (
                    <a
                      href={post.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {post.postUrl}
                    </a>
                  )}
                </div>
              )
            : (
                <>
                  <p className="text-xs text-muted-foreground">{t('publish.card.registerHint')}</p>
                  <div className="grid gap-2 md:grid-cols-[1fr_14rem]">
                    <div className="flex flex-col gap-1">
                      <Input
                        value={postUrl}
                        maxLength={POST_URL_MAX_LENGTH}
                        placeholder={t('publish.card.urlPlaceholder')}
                        disabled={readOnly || isCompleting}
                        onChange={(event) => {
                          setPostUrl(event.target.value)
                          setUrlErrorKey(null)
                        }}
                      />
                      {urlErrorKey && <p className="text-xs text-destructive">{t(urlErrorKey)}</p>}
                    </div>
                    <Input
                      value={platformPostId}
                      maxLength={PLATFORM_POST_ID_MAX_LENGTH}
                      placeholder={t('publish.card.postIdPlaceholder')}
                      disabled={readOnly || isCompleting}
                      onChange={event => setPlatformPostId(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      disabled={readOnly || isCompleting}
                      onClick={handleComplete}
                    >
                      {isCompleting
                        ? <Loader2 className="size-4 animate-spin" />
                        : <CheckCircle2 className="size-4" />}
                      {t('publish.card.complete')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={readOnly}
                      onClick={() => setFailOpen(true)}
                    >
                      <TriangleAlert className="size-4" />
                      {t('publish.card.fail')}
                    </Button>
                  </div>
                </>
              )}
        </section>
      </div>

      {/* 发失败了：填个原因 */}
      <Dialog open={failOpen} onOpenChange={setFailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('publish.card.failTitle')}</DialogTitle>
            <DialogDescription>{t('publish.card.failDesc')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={failReason}
            maxLength={PUBLISH_FAIL_REASON_MAX_LENGTH}
            placeholder={t('publish.card.failPlaceholder')}
            className="min-h-24"
            onChange={event => setFailReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" disabled={isFailing} onClick={() => setFailOpen(false)}>
              {t('publish.card.cancel')}
            </Button>
            <Button disabled={isFailing || !failReason.trim()} onClick={handleFail}>
              {isFailing ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('publish.card.failSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除登记二次确认 */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('publish.card.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('publish.card.deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('publish.card.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // 交给异步流程控制关闭时机，避免请求没回来就把弹窗关了
                event.preventDefault()
                handleDelete()
              }}
            >
              {t('publish.card.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
