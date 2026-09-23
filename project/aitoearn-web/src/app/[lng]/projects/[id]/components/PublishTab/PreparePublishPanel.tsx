/**
 * PreparePublishPanel - 选一份草稿 + 选平台 → 打包成一张发布卡片
 * 「准备发布」只做一件事：把点下去那一刻的正文、话题、配图快照下来，建一条待发登记。
 * 有图没打包进来就按原因分开提示，三种原因说三句话，不合并。
 * 它不会、也不允许往任何平台发内容，发是人自己去平台发。
 */
'use client'

import type { DraftItem } from '../DraftsTab/drafts.utils'
import type { PublishDraftNotes } from './publish.utils'
import type { PublishedPostDetail } from '@/api/publishing/publishing.types'
import { Loader2, PackageCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPublishFromDraftApi } from '@/api/publishing/publishing.api'
import { PUBLISH_MODE_MANUAL } from '@/api/publishing/publishing.constants'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/utils/ui/toast'
import { DEFAULT_DRAFT_PLATFORM } from '../DraftsTab/drafts.constants'
import { PUBLISH_PLATFORMS } from './publish.constants'
import { getPublishErrorKey, groupSkippedMedia, guessPlatformFromDraftPath } from './publish.utils'

interface PreparePublishPanelProps {
  projectId: string
  drafts: DraftItem[]
  isDraftsLoading: boolean
  /** 归档项目只读 */
  readOnly: boolean
  /**
   * 建好之后把新记录交给上层，顺带刷新列表。
   * `notes` 是这一刻服务端从草稿里读出来的提示（没声明配图、正文是整篇原文），
   * 它不落库，错过这一次就没有了，所以要一路带到卡片上。
   */
  onCreated: (post: PublishedPostDetail, notes: PublishDraftNotes) => void
  /**
   * 从「生成」页带过来的草稿路径，带了就直接选上。
   * 每次带过来都换一个 at，同一条草稿连点两次也要能重新选上
   */
  presetDraft: { path: string, at: number } | null
}

export function PreparePublishPanel(props: PreparePublishPanelProps) {
  const { projectId, drafts, isDraftsLoading, readOnly, onCreated, presetDraft } = props
  const { t } = useTransClient('projects')

  const [draftPath, setDraftPath] = useState('')
  const [platform, setPlatform] = useState<string>(DEFAULT_DRAFT_PLATFORM)
  const [isSubmitting, setIsSubmitting] = useState(false)

  /**
   * 从「生成」页带过来的草稿：直接选上，人不用在下拉里再找一遍。
   *
   * 要等草稿列表真到齐了才选：切过来的那一瞬间这个面板刚挂载、列表还在路上，
   * 这时候选上会被下面那个「草稿没了就清空」的检查当场冲掉。
   * 所以依赖里带着 drafts，列表到了再补一次。
   */
  useEffect(() => {
    const path = presetDraft?.path
    if (path && drafts.some(draft => draft.path === path))
      setDraftPath(path)
  }, [presetDraft, drafts])

  // 选中的草稿没了（被删或改名）就退回没选中。
  // 列表还在加载时不判：那会儿 drafts 是空的，判了会把刚带过来的选择误清掉
  useEffect(() => {
    if (isDraftsLoading)
      return

    if (draftPath && !drafts.some(draft => draft.path === draftPath))
      setDraftPath('')
  }, [draftPath, drafts, isDraftsLoading])

  const handleDraftChange = (value: string) => {
    setDraftPath(value)

    // 草稿目录名里带着平台，顺手替人选上，选错了还能自己改
    const guessed = guessPlatformFromDraftPath(value)
    if (guessed)
      setPlatform(guessed)
  }

  const handlePrepare = async () => {
    if (!draftPath || readOnly || isSubmitting)
      return

    setIsSubmitting(true)
    try {
      const res = await createPublishFromDraftApi(projectId, {
        draftPath,
        platform,
        mode: PUBLISH_MODE_MANUAL,
      })

      if (res && res.code === 0 && res.data?.post) {
        toast.success(t('publish.prepare.created'))

        // 有图没进快照就得说一声，不然人会以为图丢了。
        // 但三种原因要分开说：路径被拒的那几行跟 OSS 一点关系都没有，
        // 混成一句「没有 OSS 地址」会让人照着错的方向去查。
        const skipped = res.data.skippedMedia
        const skippedGroups = groupSkippedMedia(skipped)
        for (const group of skippedGroups)
          toast.warning(t(group.messageKey, { num: group.count, reason: group.reason }))

        onCreated(res.data.post, {
          postId: res.data.post.id,
          mediaDeclared: res.data.mediaDeclared !== false,
          bodyFallback: res.data.bodyFallback === true,
          // 卡片上还要再显示一遍：toast 会飘走，而路径写错那种得让人照着那一行回去改
          skippedMedia: Array.isArray(skipped) ? skipped : [],
        })
        return
      }

      toast.error(t(getPublishErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Prepare publish failed:', error)
      toast.error(t('error.network'))
    }
    finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-foreground">{t('publish.prepare.title')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('publish.prepare.desc')}</p>
      </div>

      {drafts.length === 0 && !isDraftsLoading
        ? (
            <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {t('publish.prepare.noDrafts')}
            </p>
          )
        : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="publish-draft-select">{t('publish.prepare.draftLabel')}</Label>
                  <Select
                    value={draftPath}
                    disabled={readOnly || isSubmitting || isDraftsLoading}
                    onValueChange={handleDraftChange}
                  >
                    <SelectTrigger id="publish-draft-select">
                      <SelectValue placeholder={t('publish.prepare.draftPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {drafts.map(draft => (
                        <SelectItem key={draft.path} value={draft.path}>
                          {draft.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="publish-platform-select">
                    {t('publish.prepare.platformLabel')}
                  </Label>
                  <Select
                    value={platform}
                    disabled={readOnly || isSubmitting}
                    onValueChange={setPlatform}
                  >
                    <SelectTrigger id="publish-platform-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PUBLISH_PLATFORMS.map(item => (
                        <SelectItem key={item.value} value={item.value}>
                          {t(`drafts.platform.${item.value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={readOnly || isSubmitting || !draftPath}
                  onClick={handlePrepare}
                >
                  {isSubmitting
                    ? <Loader2 className="size-4 animate-spin" />
                    : <PackageCheck className="size-4" />}
                  {isSubmitting ? t('publish.prepare.submitting') : t('publish.prepare.submit')}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t('publish.prepare.manualOnly')}
                </span>
              </div>
            </div>
          )}
    </div>
  )
}
