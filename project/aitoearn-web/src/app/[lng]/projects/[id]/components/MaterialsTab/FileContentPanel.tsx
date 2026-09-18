/**
 * FileContentPanel - 右侧内容区
 * 文本文件可编辑保存；图片优先用名片里的 OSS 地址预览，取不到再走 download 接口；
 * 其他二进制只给文件信息和下载。
 */
'use client'

import type { FileContent, FileNode } from '@/api/projects/project-file.types'
import { Download, FileWarning, Loader2, RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadProjectFileApi,
  readProjectFileApi,
  writeProjectFileApi,
} from '@/api/projects/project-file.api'
import { PROJECT_FILE_ERROR_CODE } from '@/api/projects/project-file.constants'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatFileSize } from '@/utils/format'
import { toast } from '@/utils/ui/toast'
import { getProjectErrorKey } from '../../../projects.utils'
import {
  getImageCardPathCandidates,
  isImageFileName,
  isTextFileName,
  parseFrontMatter,
} from './materials.utils'

interface FileContentPanelProps {
  projectId: string
  node: FileNode
  readOnly: boolean
  /** 保存成功后让父级刷新目录树（大小、修改时间会变） */
  onSaved: () => void
}

type PanelKind = 'loading' | 'text' | 'image' | 'binary'

/** 名片里能用上的字段 */
interface ImageCardInfo {
  path: string
  oss: string
  width?: string
  height?: string
}

export function FileContentPanel({ projectId, node, readOnly, onSaved }: FileContentPanelProps) {
  const { t } = useTransClient('projects')

  const [kind, setKind] = useState<PanelKind>('loading')
  const [fileMeta, setFileMeta] = useState<FileContent | null>(null)
  const [savedContent, setSavedContent] = useState('')
  const [draft, setDraft] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [card, setCard] = useState<ImageCardInfo | null>(null)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  // 走 download 接口预览时生成的 blob 地址，切换文件要回收
  const objectUrlRef = useRef('')
  // 切换文件时旧请求的回包要丢掉，用自增令牌判断
  const loadTokenRef = useRef(0)

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = ''
    }
  }, [])

  const loadNode = useCallback(async () => {
    setKind('loading')
    setNoticeKey(null)
    setCard(null)
    setFileMeta(null)
    setSavedContent('')
    setDraft('')
    setImageUrl('')
    releaseObjectUrl()

    loadTokenRef.current += 1
    const token = loadTokenRef.current
    const isStale = () => loadTokenRef.current !== token

    // 图片：先找名片里的 OSS 地址，没有再下载原件
    if (isImageFileName(node.name)) {
      for (const candidate of getImageCardPathCandidates(node.path)) {
        const res = await readProjectFileApi(projectId, candidate)
        if (isStale())
          return
        if (res && res.code === 0 && res.data) {
          const meta = parseFrontMatter(res.data.content)
          if (meta.oss) {
            setCard({ path: candidate, oss: meta.oss, width: meta.width, height: meta.height })
            setImageUrl(meta.oss)
            setKind('image')
            return
          }
          setCard({ path: candidate, oss: '', width: meta.width, height: meta.height })
          break
        }
      }

      try {
        const blob = await downloadProjectFileApi(projectId, node.path)
        if (isStale())
          return
        objectUrlRef.current = URL.createObjectURL(blob)
        setImageUrl(objectUrlRef.current)
        setKind('image')
      }
      catch (error) {
        console.error('Preview project image failed:', error)
        if (!isStale()) {
          setNoticeKey('materials.preview.imageFailed')
          setKind('binary')
        }
      }
      return
    }

    // 非文本扩展名直接按二进制处理，不去打读接口
    if (!isTextFileName(node.name)) {
      setKind('binary')
      return
    }

    const res = await readProjectFileApi(projectId, node.path)
    if (isStale())
      return

    if (res && res.code === 0 && res.data) {
      setFileMeta(res.data)
      setSavedContent(res.data.content)
      setDraft(res.data.content)
      setKind('text')
      return
    }

    const code = Number(res?.code)
    if (code === PROJECT_FILE_ERROR_CODE.NotText || code === PROJECT_FILE_ERROR_CODE.TooLarge) {
      setNoticeKey(getProjectErrorKey(code))
      setKind('binary')
      return
    }

    setNoticeKey(getProjectErrorKey(res?.code))
    setKind('binary')
  }, [node.name, node.path, projectId, releaseObjectUrl])

  useEffect(() => {
    loadNode()
  }, [loadNode])

  useEffect(() => releaseObjectUrl, [releaseObjectUrl])

  const handleSave = async () => {
    if (readOnly || isSaving)
      return

    setIsSaving(true)
    try {
      const res = await writeProjectFileApi(projectId, { path: node.path, content: draft })
      if (res && res.code === 0) {
        setSavedContent(draft)
        if (res.data)
          setFileMeta(res.data)
        toast.success(t('materials.editor.saveSuccess'))
        onSaved()
        return
      }
      toast.error(t(getProjectErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Save project file failed:', error)
      toast.error(t('error.network'))
    }
    finally {
      setIsSaving(false)
    }
  }

  const handleDownload = async () => {
    if (isDownloading)
      return

    setIsDownloading(true)
    try {
      const blob = await downloadProjectFileApi(projectId, node.path)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = node.name
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    }
    catch (error) {
      console.error('Download project file failed:', error)
      toast.error(t('materials.preview.downloadFailed'))
    }
    finally {
      setIsDownloading(false)
    }
  }

  const isDirty = kind === 'text' && draft !== savedContent
  const size = fileMeta?.size ?? node.size ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 文件头 */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{node.name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{node.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadNode} disabled={kind === 'loading'}>
            <RefreshCw className={kind === 'loading' ? 'size-4 animate-spin' : 'size-4'} />
            {t('action.refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t('materials.action.download')}
          </Button>
          {kind === 'text' && !readOnly && (
            <Button size="sm" onClick={handleSave} disabled={!isDirty || isSaving}>
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {isSaving ? t('detail.saving') : t('detail.save')}
            </Button>
          )}
        </div>
      </div>

      {/* 正文 */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {kind === 'loading' && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {kind === 'text' && (
          <div className="flex h-full min-h-[320px] flex-col gap-2">
            <Textarea
              className="min-h-[320px] flex-1 resize-none font-mono text-xs leading-relaxed"
              value={draft}
              readOnly={readOnly}
              spellCheck={false}
              onChange={event => setDraft(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('materials.editor.meta', {
                size: formatFileSize(size),
                time: formatDate(fileMeta?.updatedAt || node.updatedAt),
              })}
              {isDirty ? ` · ${t('materials.editor.unsaved')}` : ''}
            </p>
          </div>
        )}

        {kind === 'image' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center rounded-lg border border-border bg-muted/30 p-3">
              {/* 物料图片来自服务端 OSS 或 blob，这里不用 next/image 的域名白名单那套 */}
              {/* eslint-disable-next-line next/no-img-element */}
              <img
                src={imageUrl}
                alt={node.name}
                className="max-h-[420px] w-auto max-w-full rounded-md object-contain"
              />
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                {t('materials.editor.meta', {
                  size: formatFileSize(size),
                  time: formatDate(node.updatedAt),
                })}
              </span>
              {card?.oss ? (
                <span className="break-all">
                  {t('materials.preview.cardOss')}
                  {' '}
                  <a
                    href={card.oss}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {card.oss}
                  </a>
                </span>
              ) : (
                <span>{t('materials.preview.cardMissing')}</span>
              )}
            </div>
          </div>
        )}

        {kind === 'binary' && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <FileWarning className="mb-3 size-6 text-muted-foreground" />
            <p className="text-sm text-foreground">
              {noticeKey ? t(noticeKey) : t('materials.preview.binary')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('materials.editor.meta', {
                size: formatFileSize(size),
                time: formatDate(node.updatedAt),
              })}
            </p>
            <Button className="mt-5" variant="outline" size="sm" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t('materials.action.download')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
