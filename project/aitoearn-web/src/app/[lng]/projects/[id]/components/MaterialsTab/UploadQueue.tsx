/**
 * UploadQueue - 上传队列
 * 每个文件一行：进度、状态、取消
 */
'use client'

import type { UploadItem } from './useMaterialUpload'
import { CheckCircle2, CircleSlash, X, XCircle } from 'lucide-react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatFileSize } from '@/utils/format'

interface UploadQueueProps {
  items: UploadItem[]
  isUploading: boolean
  onCancel: (id: string) => void
  onCancelAll: () => void
  onClearFinished: () => void
}

export function UploadQueue({ items, isUploading, onCancel, onCancelAll, onClearFinished }: UploadQueueProps) {
  const { t } = useTransClient('projects')

  if (items.length === 0)
    return null

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {t('materials.upload.title', { num: items.length })}
        </h3>
        <div className="flex items-center gap-2">
          {isUploading && (
            <Button variant="ghost" size="sm" onClick={onCancelAll}>
              {t('materials.upload.cancelAll')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClearFinished}>
            {t('materials.upload.clearFinished')}
          </Button>
        </div>
      </div>

      <ul className="mt-2 flex flex-col gap-2">
        {items.map(item => (
          <li key={item.id} className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(item.size)}
              </span>
              {item.status === 'done' && <CheckCircle2 className="size-4 shrink-0 text-brand-cyan" />}
              {item.status === 'error' && <XCircle className="size-4 shrink-0 text-destructive" />}
              {item.status === 'canceled' && (
                <CircleSlash className="size-4 shrink-0 text-muted-foreground" />
              )}
              {(item.status === 'pending' || item.status === 'uploading') && (
                <button
                  type="button"
                  aria-label={t('materials.upload.cancel')}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                  onClick={() => onCancel(item.id)}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {(item.status === 'pending' || item.status === 'uploading') && (
              <Progress className="mt-2 h-1.5" value={item.progress} />
            )}

            <p className="mt-1 text-xs text-muted-foreground">
              {item.status === 'uploading' && t('materials.upload.uploading', { progress: item.progress })}
              {item.status === 'pending' && t('materials.upload.pending')}
              {item.status === 'done' && t('materials.upload.done', { dir: item.targetDir || '/', interpolation: { escapeValue: false } })}
              {item.status === 'canceled' && t('materials.upload.canceled')}
              {item.status === 'error' && t(item.errorKey || 'error.unknown')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
