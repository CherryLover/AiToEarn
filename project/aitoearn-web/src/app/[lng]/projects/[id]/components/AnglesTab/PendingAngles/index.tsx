/**
 * PendingAngles - 待确认区
 *
 * AI 提炼出来的方向先进库但标成待确认（没有 confirmedAt），不进列表、不进演进树、不进状态分组。
 * 这里把它们摆出来让人挑：改一笔、采用、或者直接删掉。
 *
 * 自包含组件：只吃 projectId，自己拉自己的数据，由「方向」标签页挂上去。
 * 采用或删除之后调 onChanged，让外面刷新已确认的那份列表。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import { ChevronDown, CircleCheckBig, Loader2, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { getAngleErrorKey } from '../angles.utils'
import { usePendingAngles } from '../useAngles'
import { PendingAngleCard } from './PendingAngleCard'

interface PendingAnglesProps {
  projectId: string
  /** 归档项目只读 */
  readOnly: boolean
  /** 采用或删除之后通知外面刷新已确认的列表 */
  onChanged: () => void
}

export function PendingAngles({ projectId, readOnly, onChanged }: PendingAnglesProps) {
  const { t } = useTransClient('projects')
  // 只拉待确认那一份：已确认的列表由「方向」标签页自己在拉，这里不重复请求
  const { pendingAngles, confirm, confirmMany, updatePending, removePending } = usePendingAngles(projectId)

  const [isOpen, setIsOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isConfirmingAll, setIsConfirmingAll] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Angle | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleConfirm = useCallback(
    async (angle: Angle) => {
      setBusyId(angle.id)
      try {
        const result = await confirm(angle.id)
        if (result.ok) {
          // 方向名是人自己起的，i18next 默认会把 & < 之类转义掉；这里和 AnglesTab 的口径保持一致
          toast.success(t('angles.pending.confirmSuccess', {
            name: angle.name,
            interpolation: { escapeValue: false },
          }))
          onChanged()
          return
        }
        toast.error(t(getAngleErrorKey(result.code)))
      }
      finally {
        setBusyId(null)
      }
    },
    [confirm, onChanged, t],
  )

  const handleConfirmAll = useCallback(async () => {
    if (isConfirmingAll || pendingAngles.length === 0)
      return

    const num = pendingAngles.length
    setIsConfirmingAll(true)
    try {
      const result = await confirmMany(pendingAngles.map(angle => angle.id))
      if (result.ok) {
        toast.success(t('angles.pending.confirmAllSuccess', { num }))
        onChanged()
        return
      }
      toast.error(t(getAngleErrorKey(result.code)))
    }
    finally {
      setIsConfirmingAll(false)
    }
  }, [confirmMany, isConfirmingAll, onChanged, pendingAngles, t])

  const handleSave = useCallback(
    async (angle: Angle, values: { name: string, desc: string }) => {
      setBusyId(angle.id)
      try {
        const result = await updatePending(angle.id, { name: values.name, desc: values.desc })
        if (result.ok) {
          toast.success(t('angles.form.saveSuccess'))
          return true
        }
        toast.error(t(getAngleErrorKey(result.code)))
        return false
      }
      finally {
        setBusyId(null)
      }
    },
    [t, updatePending],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || isDeleting)
      return

    setIsDeleting(true)
    try {
      const result = await removePending(deleteTarget.id)
      if (result.ok) {
        toast.success(t('angles.delete.success'))
        setDeleteTarget(null)
        // 待确认的删掉不影响已确认的列表，但方向文件没了，外面该重算的还是要重算
        onChanged()
        return
      }
      toast.error(t(getAngleErrorKey(result.code)))
    }
    finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, isDeleting, onChanged, removePending, t])

  // 没有待确认的就什么都不画：一条空横幅比没有更碍事
  if (pendingAngles.length === 0)
    return null

  return (
    <>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              data-testid="pending-angles-banner"
            >
              <Sparkles className="size-4 shrink-0 text-brand-cyan" />
              <span className="min-w-0">
                <span className="text-sm font-medium text-foreground">
                  {t('angles.pending.banner', { num: pendingAngles.length })}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {t('angles.pending.hint')}
                </span>
              </span>
              <ChevronDown
                className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
              />
            </button>
          </CollapsibleTrigger>

          {!readOnly && (
            <Button
              size="sm"
              className="h-8 shrink-0"
              disabled={isConfirmingAll}
              onClick={handleConfirmAll}
            >
              {isConfirmingAll
                ? <Loader2 className="size-3.5 animate-spin" />
                : <CircleCheckBig className="size-3.5" />}
              {t('angles.pending.confirmAll')}
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className="space-y-3 px-4 pb-4">
            {pendingAngles.map(angle => (
              <PendingAngleCard
                key={angle.id}
                angle={angle}
                readOnly={readOnly}
                isBusy={busyId === angle.id || isConfirmingAll}
                onConfirm={handleConfirm}
                onSave={handleSave}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('angles.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('angles.delete.desc', {
                name: deleteTarget?.name ?? '',
                slug: deleteTarget?.slug ?? '',
                interpolation: { escapeValue: false },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('angles.delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault()
                handleDelete()
              }}
            >
              {isDeleting ? t('angles.delete.deleting') : t('angles.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
