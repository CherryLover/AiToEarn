/**
 * PublishCard - 一条待发内容的打包卡片
 * 标题、正文、话题各有各的复制按钮，图片能单张或整批下载，再给一个平台创作后台的入口。
 *
 * 这张卡片就是这一轮的全部：把内容打包好交给人，人自己去平台发。
 * 页面上没有、也不许加「一键自动发布」——那是插件那条线的事。
 * 发完回来把帖子链接填进去，这条记录才转成已发布。
 */
'use client'

import type { PickedMedia, PublishDraftNotes } from './publish.utils'
import type { PublishedPostDetail } from '@/api/publishing/publishing.types'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  ImageOff,
  ImagePlus,
  Loader2,
  Trash2,
  TriangleAlert,
  X,
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
import { MediaPickerDialog } from './MediaPickerDialog'
import {
  BATCH_DOWNLOAD_GAP_MS,
  BODY_COLLAPSE_MIN_LENGTH,
  PLATFORM_CREATOR_URL,
} from './publish.constants'
import {
  buildFullCopyText,
  downloadImage,
  formatTopics,
  getPlatformLabelKey,
  getPublishErrorKey,
  groupSkippedMedia,
  mergeCardMedia,
  validatePostUrl,
} from './publish.utils'
import { LinkStatusBadge, PublishStatusBadge } from './PublishStatusBadges'
import { useProjectMedia } from './useProjectMedia'

interface PublishCardProps {
  projectId: string
  post: PublishedPostDetail
  /**
   * 刚打包那一刻服务端给的草稿提示（没声明配图、正文是整篇原文）。
   * 服务端不落库，所以只有刚建出来的这条才有；从列表里点开的老记录拿不到，传 null。
   */
  draftNotes: PublishDraftNotes | null
  /** 归档项目只读 */
  readOnly: boolean
  /** 回填 / 标失败之后把最新记录交回上层 */
  onUpdated: (post: PublishedPostDetail) => void
  /** 删除之后让上层收起卡片并刷新列表 */
  onDeleted: (id: string) => void
}

export function PublishCard(props: PublishCardProps) {
  const { projectId, post, draftNotes, readOnly, onUpdated, onDeleted } = props
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedMedia, setPickedMedia] = useState<PickedMedia[]>([])

  // media/ 里有哪些图：只有人真去挑的时候才列，卡片本身不碰物料文件
  const mediaLibrary = useProjectMedia(projectId)

  const snapshot = post.snapshot
  const topicsText = formatTopics(snapshot?.topics ?? [])
  const bodyText = snapshot?.body ?? ''
  const mediaUrls = snapshot?.mediaUrls ?? []
  // 快照里的图 + 人刚从物料里挑的图，复制、下载都按这一列来
  const mediaItems = mergeCardMedia(mediaUrls, pickedMedia)
  // 「草稿压根没写配图」和「写了但一张都没打包进来」给人的话不一样，只有服务端说得清
  const mediaUndeclared = draftNotes?.mediaDeclared === false
  const bodyFallback = draftNotes?.bodyFallback === true
  // 声明了但没打包进来的图，按原因分组：三种原因要说三句话，合成一句就等于说错话
  const skippedGroups = groupSkippedMedia(draftNotes?.skippedMedia)
  const fullText = snapshot ? buildFullCopyText(snapshot) : ''
  const canCollapseBody = bodyText.length > BODY_COLLAPSE_MIN_LENGTH

  const platformLabelKey = getPlatformLabelKey(post.platform)
  const platformLabel = platformLabelKey ? t(platformLabelKey) : post.platform
  const creatorUrl = PLATFORM_CREATOR_URL[post.platform] ?? ''
  const isPublished = post.publishStatus === PublishStatus.Published

  const handleDownloadOne = async (url: string, fileName: string) => {
    const ok = await downloadImage(url, fileName)
    if (!ok)
      toast.warning(t('publish.card.downloadFallback'))
  }

  const handleDownloadAll = async () => {
    if (downloadingAll || mediaItems.length === 0)
      return

    setDownloadingAll(true)
    try {
      let fallbackCount = 0
      for (let index = 0; index < mediaItems.length; index += 1) {
        const ok = await downloadImage(mediaItems[index].url, mediaItems[index].fileName)
        if (!ok)
          fallbackCount += 1

        // 连着触发下载会被浏览器拦，隔一小会儿再来下一张
        if (index < mediaItems.length - 1)
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

  /**
   * 挑好的图并进这次发布的配图。
   * 只落在这张卡片上：草稿文件不动，快照也不改——快照是点「准备发布」那一刻定下来的，
   * 回头改它就等于把「发出去的是哪一版」搅浑了。
   */
  const handleMediaPicked = (picks: PickedMedia[]) => {
    const pickedPaths = new Set(pickedMedia.map(item => item.path))
    const existingUrls = new Set([...mediaUrls, ...pickedMedia.map(item => item.url)])

    const added = picks.filter(
      pick => !pickedPaths.has(pick.path) && !(pick.ossUrl && existingUrls.has(pick.ossUrl)),
    )
    const duplicated = picks.length - added.length

    if (added.length > 0) {
      setPickedMedia(prev => [...prev, ...added])
      toast.success(t('publish.mediaPicker.added', { num: added.length }))
    }

    if (duplicated > 0)
      toast.warning(t('publish.mediaPicker.alreadyIn', { num: duplicated }))
  }

  const handleRemovePicked = (path: string) => {
    setPickedMedia(prev => prev.filter(item => item.path !== path))
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

        {/* 草稿没按小节写，正文是整篇原文：发之前得人工删一刀 */}
        {bodyFallback && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('publish.card.bodyFallbackTitle')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('publish.card.bodyFallbackHint')}
              </p>
            </div>
          </div>
        )}

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              {t('publish.card.mediaLabel')}
              {mediaItems.length > 0 ? ` (${mediaItems.length})` : ''}
            </Label>
            <div className="flex items-center gap-2">
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                >
                  <ImagePlus className="size-4" />
                  {t('publish.card.pickMedia')}
                </Button>
              )}
              {mediaItems.length > 1 && (
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
          </div>

          {/*
            声明了、但没能进快照的图。按原因分开列，各说各的：
            路径被拒的那几行跟 OSS 一点关系都没有，混成「没有 OSS 地址」会让人照着错的方向查半天。
            toast 会飘走，所以这儿再留一份，并且把服务端给回来的那几行原样显示出来，人才知道回草稿改哪儿。
          */}
          {skippedGroups.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t('publish.skipped.title')}</p>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {skippedGroups.map((group) => {
                    const paths = group.paths.filter(Boolean)

                    return (
                      <li key={group.reason} className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {t(group.messageKey, { num: group.count, reason: group.reason })}
                        </p>
                        {paths.length > 0 && (
                          <p className="mt-0.5 break-all font-mono text-[0.7rem] text-muted-foreground/80">
                            {paths.join('  ·  ')}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )}

          {mediaItems.length === 0
            ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-8 text-center">
                  <ImageOff className="mb-2 size-5 text-muted-foreground" />
                  {/* 草稿压根没写配图，和「写了但没打包进来」不是一回事，说法也不一样 */}
                  <p className="text-sm text-foreground">
                    {mediaUndeclared ? t('publish.card.mediaUndeclared') : t('publish.card.noMedia')}
                  </p>
                  {/* 上面已经按原因一条条说过为什么没打包进来了，这儿就别再补一句笼统的 */}
                  {skippedGroups.length === 0 && (
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                      {mediaUndeclared
                        ? t('publish.card.mediaUndeclaredHint')
                        : t('publish.card.noMediaHint')}
                    </p>
                  )}
                </div>
              )
            : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {mediaItems.map((item) => {
                    // 只有挑来的图能移掉，快照里的那几张是发布那一刻定死的
                    const removablePath = item.picked ? item.path : undefined

                    return (
                      <figure
                        key={item.key}
                        className="relative overflow-hidden rounded-lg border border-border bg-muted/30"
                      >
                        {/* 图片是 OSS 外链或本地 blob，不走 next/image 的域名白名单那套 */}
                        {/* eslint-disable-next-line next/no-img-element */}
                        <img src={item.url} alt={item.fileName} className="h-32 w-full object-cover" />
                        {item.picked && (
                          <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                            {t('publish.card.pickedLabel')}
                          </span>
                        )}
                        <figcaption className="flex items-center justify-between gap-1 px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-muted-foreground">
                            {item.fileName}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            aria-label={t('publish.card.download')}
                            onClick={() => handleDownloadOne(item.url, item.fileName)}
                          >
                            <Download className="size-4" />
                          </Button>
                          {removablePath && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              aria-label={t('publish.card.removePicked')}
                              onClick={() => handleRemovePicked(removablePath)}
                            >
                              <X className="size-4" />
                            </Button>
                          )}
                        </figcaption>
                      </figure>
                    )
                  })}
                </div>
              )}

          {/* 挑来的图只活在这张卡片上，说清楚免得人以为草稿被改了 */}
          {pickedMedia.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('publish.card.pickedHint')}</p>
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

      {/* 从物料里挑图：纯粹是翻项目 media/ 给人选，选完摆在卡片上，不发任何东西 */}
      {!readOnly && (
        <MediaPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          library={mediaLibrary}
          existingUrls={[...mediaUrls, ...pickedMedia.map(item => item.ossUrl).filter(Boolean)]}
          pickedPaths={pickedMedia.map(item => item.path)}
          onConfirm={handleMediaPicked}
        />
      )}

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
