/**
 * DraftDetail - 一条草稿的正文、配图和血缘
 * 正文可以直接改、直接存，写回 drafts/<草稿>/content.md（走阶段 1 的文件接口）。
 * 配图优先用名片里的 OSS 地址，取不到再下载原件预览。
 * 血缘回答的是「这条是怎么来的」：哪个方向、哪个平台、吃了哪些物料、什么提示词、哪个模型。
 */
'use client'

import type { DraftContent, DraftItem, DraftMeta } from './drafts.utils'
import { FileWarning, ImageOff, Loader2, RefreshCw, Save, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadProjectFileApi,
  readProjectFileApi,
  writeProjectFileApi,
} from '@/api/projects/project-file.api'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatDate } from '@/utils/format'
import { toast } from '@/utils/ui/toast'
import { getProjectErrorKey } from '../../../projects.utils'
import { getImageCardPathCandidates } from '../MaterialsTab/materials.utils'
import {
  collectDraftImageRefs,
  isRemoteUrl,
  parseDraftContent,
  parseDraftMeta,
  parseFrontMatter,
  parseJsonObject,
} from './drafts.utils'

interface DraftDetailProps {
  projectId: string
  draft: DraftItem
  readOnly: boolean
  /** 保存成功后让父级刷新列表（修改时间会变） */
  onSaved: () => void
  /** 拿这条去发布：切到「发布」页，草稿已经选好 */
  onGoPublish: (draft: DraftItem) => void
}

interface DraftImage {
  ref: string
  url: string
  /** 名片里的 OSS 地址，没有就是空串 */
  ossUrl: string
}

export function DraftDetail({ projectId, draft, readOnly, onSaved, onGoPublish }: DraftDetailProps) {
  const { t } = useTransClient('projects')

  const [isLoading, setIsLoading] = useState(true)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [savedText, setSavedText] = useState('')
  const [draftText, setDraftText] = useState('')
  const [content, setContent] = useState<DraftContent | null>(null)
  const [meta, setMeta] = useState<DraftMeta | null>(null)
  const [images, setImages] = useState<DraftImage[]>([])
  const [failedImages, setFailedImages] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  // 走 download 接口预览时生成的 blob 地址，切草稿要回收
  const objectUrlsRef = useRef<string[]>([])
  // 切草稿时旧请求的回包要丢掉
  const loadTokenRef = useRef(0)

  const releaseObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    objectUrlsRef.current = []
  }, [])

  /** 一个图片引用解析成能显示的地址：外链直接用，项目里的先找名片、再退回下载 */
  const resolveImage = useCallback(
    async (ref: string): Promise<DraftImage | null> => {
      if (isRemoteUrl(ref))
        return { ref, url: ref, ossUrl: ref }

      for (const candidate of getImageCardPathCandidates(ref)) {
        const res = await readProjectFileApi(projectId, candidate)
        if (res && res.code === 0 && res.data) {
          const { data } = parseFrontMatter(res.data.content)
          const oss = typeof data.oss === 'string' ? data.oss : ''
          if (oss)
            return { ref, url: oss, ossUrl: oss }
          break
        }
      }

      try {
        const blob = await downloadProjectFileApi(projectId, ref)
        const url = URL.createObjectURL(blob)
        objectUrlsRef.current.push(url)
        return { ref, url, ossUrl: '' }
      }
      catch (error) {
        console.error('Preview draft image failed:', error)
        return null
      }
    },
    [projectId],
  )

  const loadDraft = useCallback(async () => {
    setIsLoading(true)
    setNoticeKey(null)
    setContent(null)
    setMeta(null)
    setImages([])
    setFailedImages([])
    setSavedText('')
    setDraftText('')
    releaseObjectUrls()

    loadTokenRef.current += 1
    const token = loadTokenRef.current
    const isStale = () => loadTokenRef.current !== token

    if (!draft.contentPath) {
      setNoticeKey('drafts.detail.noContent')
      setIsLoading(false)
      return
    }

    const contentRes = await readProjectFileApi(projectId, draft.contentPath)
    if (isStale())
      return

    let parsedContent: DraftContent | null = null
    if (contentRes && contentRes.code === 0 && contentRes.data) {
      parsedContent = parseDraftContent(contentRes.data.content)
      setSavedText(contentRes.data.content)
      setDraftText(contentRes.data.content)
      setContent(parsedContent)
    }
    else {
      setNoticeKey(getProjectErrorKey(contentRes?.code))
    }

    let metaRaw: Record<string, unknown> | null = null
    if (draft.metaPath) {
      const metaRes = await readProjectFileApi(projectId, draft.metaPath)
      if (isStale())
        return

      if (metaRes && metaRes.code === 0 && metaRes.data) {
        metaRaw = parseJsonObject(metaRes.data.content)
        setMeta(metaRaw ? parseDraftMeta(metaRaw) : null)
      }
    }

    const refs = collectDraftImageRefs(parsedContent, metaRaw, draft.path)
    if (refs.length > 0) {
      const resolved = await Promise.all(refs.map(ref => resolveImage(ref)))
      if (isStale()) {
        releaseObjectUrls()
        return
      }

      setImages(resolved.filter((item): item is DraftImage => item !== null))
      setFailedImages(refs.filter((_, index) => resolved[index] === null))
    }

    if (!isStale())
      setIsLoading(false)
  }, [draft.contentPath, draft.metaPath, draft.path, projectId, releaseObjectUrls, resolveImage])

  useEffect(() => {
    loadDraft()
  }, [loadDraft])

  useEffect(() => releaseObjectUrls, [releaseObjectUrls])

  const handleSave = async () => {
    if (readOnly || isSaving || !draft.contentPath)
      return

    setIsSaving(true)
    try {
      const res = await writeProjectFileApi(projectId, {
        path: draft.contentPath,
        content: draftText,
      })
      if (res && res.code === 0) {
        setSavedText(draftText)
        setContent(parseDraftContent(draftText))
        toast.success(t('drafts.detail.saveSuccess'))
        onSaved()
        return
      }
      toast.error(t(getProjectErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Save draft failed:', error)
      toast.error(t('error.network'))
    }
    finally {
      setIsSaving(false)
    }
  }

  const isDirty = draftText !== savedText

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头 */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">
            {content?.title || draft.name}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {draft.contentPath || draft.path}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 草稿写完，下一步就是拿去发。不给这个入口的话，人得切到「发布」页
              在下拉里把刚写完的这条再找一遍——上一秒刚看着它，下一秒还要重选 */}
          {!readOnly && (
            <Button size="sm" onClick={() => onGoPublish(draft)}>
              <Send className="size-3.5" />
              {t('drafts.detail.goPublish')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={loadDraft}>
            <RefreshCw className="size-4" />
            {t('action.refresh')}
          </Button>
          {!readOnly && draft.contentPath && (
            <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? t('detail.saving') : t('detail.save')}
            </Button>
          )}
        </div>
      </div>

      {noticeKey && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <FileWarning className="size-3.5 shrink-0" />
          {t(noticeKey)}
        </div>
      )}

      {/* 正文 / 配图 / 血缘 */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Tabs defaultValue="content">
          <TabsList>
            <TabsTrigger value="content">{t('drafts.detail.content')}</TabsTrigger>
            <TabsTrigger value="media">
              {t('drafts.detail.media')}
              {images.length > 0 ? ` (${images.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="lineage">{t('drafts.detail.lineage')}</TabsTrigger>
          </TabsList>

          <TabsContent value="content">
            <div className="mt-3 flex flex-col gap-3">
              {Boolean(content?.title || content?.topics.length) && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  {content?.title && (
                    <p className="text-sm font-medium text-foreground">{content.title}</p>
                  )}
                  {content && content.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {content.topics.map(topic => (
                        <span
                          key={topic}
                          className="rounded-md bg-accent px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {topic.startsWith('#') ? topic : `#${topic}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Textarea
                className="min-h-[22rem] resize-none font-mono text-xs leading-relaxed"
                value={draftText}
                readOnly={readOnly || !draft.contentPath}
                spellCheck={false}
                onChange={event => setDraftText(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('drafts.detail.meta', { time: formatDate(draft.updatedAt) })}
                {isDirty ? ` · ${t('drafts.detail.unsaved')}` : ''}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="media">
            <div className="mt-3">
              {images.length === 0 && failedImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center">
                  <ImageOff className="mb-2 size-5 text-muted-foreground" />
                  <p className="text-sm text-foreground">{t('drafts.detail.noMedia')}</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    {t('drafts.detail.noMediaHint')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {images.map(image => (
                    <figure
                      key={image.ref}
                      className="overflow-hidden rounded-lg border border-border bg-muted/30"
                    >
                      {/* 草稿配图来自 OSS 或 blob，这里不走 next/image 的域名白名单那套 */}
                      {/* eslint-disable-next-line next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.ref}
                        className="h-32 w-full object-cover"
                      />
                      <figcaption className="truncate px-2 py-1.5 font-mono text-[0.7rem] text-muted-foreground">
                        {image.ref}
                      </figcaption>
                    </figure>
                  ))}
                  {failedImages.map(ref => (
                    <div
                      key={ref}
                      className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-2 py-6 text-center"
                    >
                      <ImageOff className="size-4 text-muted-foreground" />
                      <span className="break-all font-mono text-[0.7rem] text-muted-foreground">
                        {ref}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('drafts.detail.mediaFailed')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="lineage">
            <div className="mt-3">
              {!meta ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
                  <p className="text-sm text-foreground">{t('drafts.lineage.missing')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('drafts.lineage.missingHint')}
                  </p>
                </div>
              ) : (
                <dl className="flex flex-col gap-3 text-sm">
                  <LineageRow label={t('drafts.lineage.angle')} value={meta.angleSlug} mono />
                  <LineageRow label={t('drafts.lineage.platform')} value={meta.platform} />
                  <LineageRow label={t('drafts.lineage.project')} value={meta.projectName} mono />
                  <LineageRow label={t('drafts.lineage.model')} value={meta.model} mono />
                  <LineageRow
                    label={t('drafts.lineage.createdAt')}
                    value={formatDraftTime(meta.createdAt)}
                  />

                  <div>
                    <dt className="text-xs text-muted-foreground">{t('drafts.lineage.sources')}</dt>
                    <dd className="mt-1">
                      {meta.sourceAssetPaths.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          {t('drafts.lineage.none')}
                        </span>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {meta.sourceAssetPaths.map(path => (
                            <li key={path} className="break-all font-mono text-xs text-muted-foreground">
                              {path}
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-muted-foreground">{t('drafts.lineage.prompt')}</dt>
                    <dd className="mt-1">
                      {meta.promptSnapshot ? (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
                          {meta.promptSnapshot}
                        </pre>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {t('drafts.lineage.none')}
                        </span>
                      )}
                    </dd>
                  </div>

                  {Object.entries(meta.extra).map(([key, value]) => (
                    <LineageRow key={key} label={key} value={value} mono />
                  ))}
                </dl>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/** meta.json 里的时间是 AI 写的，格式不一定标准，认不出来就原样显示 */
function formatDraftTime(raw: string): string {
  if (!raw)
    return ''

  const formatted = formatDate(raw)
  return formatted.includes('Invalid') ? raw : formatted
}

function LineageRow({ label, value, mono }: { label: string, value: string, mono?: boolean }) {
  const { t } = useTransClient('projects')

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          value
            ? `min-w-0 break-all text-sm text-foreground${mono ? ' font-mono text-xs' : ''}`
            : 'text-sm text-muted-foreground'
        }
      >
        {value || t('drafts.lineage.none')}
      </dd>
    </div>
  )
}
