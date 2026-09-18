/**
 * MediaPickerDialog - 从项目 media/ 里挑图
 * 列出物料里已有的图片，多选、能调顺序，确认之后并进这张卡片的配图。
 *
 * 这是给人挑图用的：挑完的图和快照里的图一样，复制内容的时候自己配上去、要用就下载下来。
 * 挑图不写回草稿，也不触发任何发布动作——页面上从头到尾没有替人发内容的东西。
 */
'use client'

import type { PickedMedia } from './publish.utils'
import type { ProjectMediaLibrary } from './useProjectMedia'
import type { FileNode } from '@/api/projects/project-file.types'
import { ChevronLeft, ChevronRight, ImageOff, Images, Loader2, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/className'
import { getFileBaseName } from './publish.utils'

/** 加载态占位的固定键，省得拿数组下标当 key */
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']

interface MediaPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  library: ProjectMediaLibrary
  /** 已经在卡片配图里的地址，用来把重复的图标出来 */
  existingUrls: string[]
  /** 已经挑过的图片路径 */
  pickedPaths: string[]
  onConfirm: (picks: PickedMedia[]) => void
}

interface MediaThumbProps {
  file: FileNode
  library: ProjectMediaLibrary
  /** 在已选列表里排第几（从 1 起），没选是 0 */
  order: number
  /** 这张已经在配图里了，不用再挑 */
  alreadyIn: boolean
  onToggle: (path: string) => void
}

/**
 * 一张图的缩略图。
 * 滚到视野里才去解析地址：一个项目的 media/ 可能有上百张图，进对话框就全解析一遍要发几百个请求。
 */
function MediaThumb({ file, library, order, alreadyIn, onToggle }: MediaThumbProps) {
  const { t } = useTransClient('projects')

  const boxRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  const preview = library.previews[file.path]
  const isFailed = library.failed[file.path] === true
  const selected = order > 0

  useEffect(() => {
    const node = boxRef.current
    if (!node || visible)
      return

    // 老浏览器没有 IntersectionObserver：直接当成可见，退化成进来就解析
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting))
        setVisible(true)
    }, { rootMargin: '120px' })

    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (visible)
      void library.resolve(file.path)
  }, [file.path, library, visible])

  return (
    <div ref={boxRef}>
      <button
        type="button"
        aria-pressed={selected}
        disabled={alreadyIn}
        onClick={() => onToggle(file.path)}
        className={cn(
          'group relative block w-full overflow-hidden rounded-lg border bg-muted/30 text-left transition-colors',
          selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50',
          alreadyIn ? 'cursor-not-allowed opacity-60' : '',
        )}
      >
        <div className="flex h-28 items-center justify-center overflow-hidden">
          {preview
            ? (
                /* 物料图片来自 OSS 或 blob，这里不走 next/image 的域名白名单那套 */
                /* eslint-disable-next-line next/no-img-element */
                <img src={preview.url} alt={file.name} className="size-full object-cover" />
              )
            : isFailed
              ? <ImageOff className="size-5 text-muted-foreground" />
              : <Skeleton className="size-full rounded-none" />}
        </div>

        {selected && (
          <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[0.7rem] font-medium text-primary-foreground">
            {order}
          </span>
        )}

        {alreadyIn && (
          <span className="absolute right-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
            {t('publish.mediaPicker.alreadyPicked')}
          </span>
        )}

        <span className="block truncate px-2 py-1.5 font-mono text-[0.7rem] text-muted-foreground">
          {file.name}
        </span>
      </button>
    </div>
  )
}

export function MediaPickerDialog(props: MediaPickerDialogProps) {
  const { open, onOpenChange, library, existingUrls, pickedPaths, onConfirm } = props
  const { t } = useTransClient('projects')

  const [selected, setSelected] = useState<string[]>([])
  const [isConfirming, setIsConfirming] = useState(false)

  const { load } = library

  // 每次打开都重新列一遍：人很可能刚在「物料」标签页传了新图
  useEffect(() => {
    if (!open)
      return

    setSelected([])
    void load()
  }, [load, open])

  const toggle = useCallback((path: string) => {
    setSelected(prev => (prev.includes(path) ? prev.filter(item => item !== path) : [...prev, path]))
  }, [])

  const move = (index: number, offset: number) => {
    setSelected((prev) => {
      const target = index + offset
      if (target < 0 || target >= prev.length)
        return prev

      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const handleConfirm = async () => {
    if (selected.length === 0 || isConfirming)
      return

    setIsConfirming(true)
    try {
      const picks: PickedMedia[] = []
      // 挑的时候可能还没滚到那张图，地址没解析出来，确认时补一遍
      for (const path of selected) {
        const preview = await library.resolve(path)
        if (!preview)
          continue

        picks.push({
          path,
          name: getFileBaseName(path),
          url: preview.url,
          ossUrl: preview.ossUrl,
        })
      }

      onConfirm(picks)
      onOpenChange(false)
    }
    finally {
      setIsConfirming(false)
    }
  }

  const isAlreadyIn = (file: FileNode) => {
    if (pickedPaths.includes(file.path))
      return true

    const ossUrl = library.previews[file.path]?.ossUrl
    return Boolean(ossUrl) && existingUrls.includes(ossUrl)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(880px,95vw)]">
        <DialogHeader>
          <DialogTitle>{t('publish.mediaPicker.title')}</DialogTitle>
          <DialogDescription>{t('publish.mediaPicker.desc')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto pr-1">
          {library.isLoading
            ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {SKELETON_KEYS.map(key => (
                    <Skeleton key={key} className="h-36 rounded-lg" />
                  ))}
                </div>
              )
            : library.loadFailed
              ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                    <p className="text-sm text-foreground">{t('publish.mediaPicker.loadFailed')}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                      <RefreshCw className="size-4" />
                      {t('publish.mediaPicker.retry')}
                    </Button>
                  </div>
                )
              : library.files.length === 0
                ? (
                    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
                      <Images className="mb-2 size-5 text-muted-foreground" />
                      <p className="text-sm text-foreground">{t('publish.mediaPicker.empty')}</p>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        {t('publish.mediaPicker.emptyHint')}
                      </p>
                    </div>
                  )
                : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {library.files.map(file => (
                        <MediaThumb
                          key={file.path}
                          file={file}
                          library={library}
                          order={selected.indexOf(file.path) + 1}
                          alreadyIn={isAlreadyIn(file)}
                          onToggle={toggle}
                        />
                      ))}
                    </div>
                  )}

          {library.truncated && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('publish.mediaPicker.truncated', { num: library.files.length })}
            </p>
          )}
        </div>

        {selected.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {t('publish.mediaPicker.selectedTitle', { num: selected.length })}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                {t('publish.mediaPicker.clear')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('publish.mediaPicker.selectedHint')}</p>
            <ul className="flex flex-col gap-1.5">
              {selected.map((path, index) => (
                <li
                  key={path}
                  className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1"
                >
                  <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {path}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    disabled={index === 0}
                    aria-label={t('publish.mediaPicker.moveUp')}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    disabled={index === selected.length - 1}
                    aria-label={t('publish.mediaPicker.moveDown')}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={t('publish.mediaPicker.remove')}
                    onClick={() => toggle(path)}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{t('publish.mediaPicker.notAuto')}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isConfirming}
              onClick={() => onOpenChange(false)}
            >
              {t('publish.mediaPicker.cancel')}
            </Button>
            <Button
              type="button"
              disabled={selected.length === 0 || isConfirming}
              onClick={handleConfirm}
            >
              {isConfirming ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('publish.mediaPicker.confirm')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
