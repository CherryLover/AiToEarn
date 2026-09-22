/**
 * AnglesTab - 项目详情页「方向」标签页
 * 方向是待验证的假设，不是分类：能手建、能让 AI 从物料里提炼、能从一个方向深入派生子方向。
 * 默认看演进树，一眼看出哪条线在往下长、哪条试两次就断了；也能切成按状态分组。
 *
 * 「让 AI 提炼方向」不在这里跑：它只是往右侧那条项目对话里发一句话，
 * 跑完由页面回调 refreshSignal 通知这里去登记并刷新。想法是聊出来的，不该困在一个一次性弹窗里。
 */
'use client'

import type { AngleFormState, AngleFormValues } from './AngleFormDialog'
import type { Angle, AngleStatus } from '@/api/angles/angle.types'
import { GitBranch, LayoutList, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { AngleFormDialog } from './AngleFormDialog'
import {
  buildAngleTree,
  buildExtractAnglesPrompt,
  getAngleErrorKey,
  groupAnglesByStatus,
  suggestChildSlug,
} from './angles.utils'
import { AngleStatusGroups } from './AngleStatusGroups'
import { AngleTree } from './AngleTree'
import { PendingAngles } from './PendingAngles'
import { useAngles } from './useAngles'

interface AnglesTabProps {
  projectId: string
  /** 项目英文名，AI 任务靠它锁定工作目录 */
  projectName: string
  /** 归档项目只读 */
  readOnly: boolean
  /** 把一句话丢进右侧的项目对话里 */
  onAskAi: (prompt: string) => void
  /** 页面每跑完一轮 AI 任务就加一，收到就去登记并刷新 */
  refreshSignal: number
}

type AngleView = 'tree' | 'status'

export function AnglesTab({ projectId, projectName, readOnly, onAskAi, refreshSignal }: AnglesTabProps) {
  const { t } = useTransClient('projects')

  const { angles, isLoading, loadFailed, refresh, sync, create, derive, update, remove } = useAngles(projectId)

  const [view, setView] = useState<AngleView>('tree')
  const [formState, setFormState] = useState<AngleFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Angle | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const tree = useMemo(() => buildAngleTree(angles), [angles])
  const groups = useMemo(() => groupAnglesByStatus(angles), [angles])
  const takenSlugs = useMemo(() => angles.map(angle => angle.slug), [angles])
  const childCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    angles.forEach((angle) => {
      if (angle.parentAngleId)
        counts[angle.parentAngleId] = (counts[angle.parentAngleId] ?? 0) + 1
    })
    return counts
  }, [angles])

  const handleStatusChange = useCallback(
    async (angle: Angle, status: AngleStatus) => {
      if (status === angle.status)
        return

      setUpdatingId(angle.id)
      try {
        const result = await update(angle.id, { status })
        if (result.ok) {
          toast.success(t('angles.statusChange.success', { status: t(`angles.status.${status}`) }))
          return
        }
        toast.error(t(getAngleErrorKey(result.code)))
      }
      finally {
        setUpdatingId(null)
      }
    },
    [t, update],
  )

  const handleFormSubmit = useCallback(
    async (state: AngleFormState, values: AngleFormValues) => {
      if (state.mode === 'edit' && state.angle) {
        const result = await update(state.angle.id, {
          name: values.name,
          desc: values.desc,
          status: values.status,
        })
        if (result.ok) {
          toast.success(t('angles.form.saveSuccess'))
          return true
        }
        toast.error(t(getAngleErrorKey(result.code)))
        return false
      }

      if (state.mode === 'derive' && state.angle) {
        const result = await derive(state.angle.id, {
          slug: values.slug,
          name: values.name,
          desc: values.desc || undefined,
        })
        if (result.ok) {
          toast.success(t('angles.form.deriveSuccess'))
          return true
        }
        toast.error(t(getAngleErrorKey(result.code)))
        return false
      }

      const result = await create({
        slug: values.slug,
        name: values.name,
        desc: values.desc || undefined,
      })
      if (result.ok) {
        toast.success(t('angles.form.createSuccess'))
        return true
      }
      toast.error(t(getAngleErrorKey(result.code)))
      return false
    },
    [create, derive, t, update],
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || isDeleting)
      return

    setIsDeleting(true)
    try {
      const result = await remove(deleteTarget.id)
      if (result.ok) {
        toast.success(t('angles.delete.success'))
        setDeleteTarget(null)
        return
      }
      toast.error(t(getAngleErrorKey(result.code)))
    }
    finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, isDeleting, remove, t])

  /**
   * AI 干完一轮只是把 angles/<slug>.md 写进了项目目录，数据库里还是空的。
   * 先登记（/angles/sync）再看列表，少了这一步，提炼完页面照样是空的。
   */
  const syncFromFiles = useCallback(async () => {
    const result = await sync()
    if (result.ok)
      return

    toast.error(t(getAngleErrorKey(result.code)))
    await refresh()
  }, [refresh, sync, t])

  // 右侧对话每跑完一轮，页面把 refreshSignal 加一。
  // 初始值 0 不处理，否则一进页面就会白跑一次登记。
  useEffect(() => {
    if (refreshSignal > 0)
      void syncFromFiles()
  }, [refreshSignal, syncFromFiles])

  /** 「让 AI 提炼方向」= 往右侧那条对话里发一句话，接着之前聊的往下走 */
  const handleExtract = useCallback(() => {
    onAskAi(buildExtractAnglesPrompt(projectName, takenSlugs))
  }, [onAskAi, projectName, takenSlugs])

  const openCreate = () => setFormState({ mode: 'create' })
  const openDerive = (angle: Angle) =>
    setFormState({ mode: 'derive', angle, suggestedSlug: suggestChildSlug(angle.slug, takenSlugs) })
  const openEdit = (angle: Angle) => setFormState({ mode: 'edit', angle })

  if (isLoading && angles.length === 0) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <h3 className="text-base font-medium text-foreground">{t('angles.loadFailed')}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('angles.loadFailedDesc')}</p>
        <Button className="mt-6" variant="outline" onClick={refresh}>
          <RefreshCw className="size-4" />
          {t('action.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-4">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{t('angles.title')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('angles.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {angles.length > 0 && (
            <div className="flex items-center rounded-lg border border-border p-0.5">
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                  view === 'tree' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setView('tree')}
              >
                <GitBranch className="size-3.5" />
                {t('angles.view.tree')}
              </button>
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                  view === 'status' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setView('status')}
              >
                <LayoutList className="size-3.5" />
                {t('angles.view.status')}
              </button>
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('action.refresh')}
            disabled={isLoading}
            onClick={refresh}
          >
            <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          </Button>

          {!readOnly && (
            <>
              <Button variant="outline" size="sm" onClick={handleExtract}>
                <Sparkles className="size-4" />
                {t('angles.action.extract')}
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                {t('angles.action.create')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 待确认区：AI 提炼的方向先进这里，人点了采用才进下面的树和分组。
          key 带上 refreshSignal：它自己拉自己的数据，跑完一轮 AI 任务要让它重新拉一次 */}
      {!readOnly && (
        <div className="mt-4">
          <PendingAngles
            key={`pending-${refreshSignal}`}
            projectId={projectId}
            readOnly={readOnly}
            onChanged={refresh}
          />
        </div>
      )}

      {/* 正文 */}
      {angles.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <h3 className="text-base font-medium text-foreground">{t('angles.empty.title')}</h3>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t('angles.empty.desc')}</p>
          <p className="mt-2 max-w-lg text-xs text-muted-foreground">{t('angles.empty.hint')}</p>
          {!readOnly && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={handleExtract}>
                <Sparkles className="size-4" />
                {t('angles.empty.extract')}
              </Button>
              <Button variant="outline" onClick={openCreate}>
                <Plus className="size-4" />
                {t('angles.empty.create')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          {view === 'tree' ? (
            <AngleTree
              nodes={tree}
              readOnly={readOnly}
              updatingId={updatingId}
              onStatusChange={handleStatusChange}
              onDerive={openDerive}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          ) : (
            <AngleStatusGroups
              groups={groups}
              childCounts={childCounts}
              readOnly={readOnly}
              updatingId={updatingId}
              onStatusChange={handleStatusChange}
              onDerive={openDerive}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          )}
        </div>
      )}

      <AngleFormDialog
        state={formState}
        takenSlugs={takenSlugs}
        onOpenChange={open => !open && setFormState(null)}
        onSubmit={handleFormSubmit}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
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
                // 等请求回来再关，别提前把弹窗收掉
                event.preventDefault()
                handleDelete()
              }}
            >
              {isDeleting ? t('angles.delete.deleting') : t('angles.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
