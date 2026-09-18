/**
 * AngleCard - 一个方向
 * 演进树和按状态分组两个视图共用：状态就地可改，能从这个方向深入，也能改说明和删除。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import { GitBranch, Loader2, Pencil, Trash2 } from 'lucide-react'
import { ANGLE_STATUS_ORDER } from '@/api/angles/angle.constants'
import { AngleSource, AngleStatus } from '@/api/angles/angle.types'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/utils/className'

interface AngleCardProps {
  angle: Angle
  /** 树视图里挂在它下面的直接子方向数量，0 表示这条线还没往下长 */
  childCount?: number
  readOnly: boolean
  isUpdating: boolean
  onStatusChange: (angle: Angle, status: AngleStatus) => void
  onDerive: (angle: Angle) => void
  onEdit: (angle: Angle) => void
  onDelete: (angle: Angle) => void
}

/** 状态对应的徽章样式，淘汰的压暗，有效的给绿色 */
const STATUS_BADGE_CLASS: Record<AngleStatus, string> = {
  [AngleStatus.Candidate]: 'border-border bg-muted/60 text-muted-foreground',
  [AngleStatus.Testing]: 'border-transparent bg-brand-cyan/15 text-brand-cyan',
  [AngleStatus.Effective]: 'border-transparent bg-green-500/15 text-green-600 dark:text-green-400',
  [AngleStatus.Retired]: 'border-dashed border-border bg-transparent text-muted-foreground/70',
}

export function AngleCard(props: AngleCardProps) {
  const { angle, childCount = 0, readOnly, isUpdating, onStatusChange, onDerive, onEdit, onDelete } = props
  const { t } = useTransClient('projects')

  const isRetired = angle.status === AngleStatus.Retired
  const sourcePaths = angle.sourceAssetPaths ?? []

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-3 transition-colors',
        isRetired && 'opacity-70',
      )}
      data-testid={`angle-card-${angle.slug}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={cn('text-sm font-medium text-foreground', isRetired && 'line-through')}>
              {angle.name}
            </h4>
            <span
              className={cn(
                'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
                STATUS_BADGE_CLASS[angle.status] ?? STATUS_BADGE_CLASS[AngleStatus.Candidate],
              )}
            >
              {t(`angles.status.${angle.status}`)}
            </span>
            <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {t(`angles.source.${angle.source ?? AngleSource.User}`)}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{angle.slug}</p>
        </div>

        {childCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/60 px-2 py-0.5 text-xs text-muted-foreground">
            <GitBranch className="size-3.5" />
            {t('angles.card.childCount', { num: childCount })}
          </span>
        )}
      </div>

      <p className={cn('mt-2 text-sm', angle.desc ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
        {angle.desc || t('angles.card.noDesc')}
      </p>

      {sourcePaths.length > 0 && (
        <p className="mt-2 truncate font-mono text-xs text-muted-foreground/80">
          {t('angles.card.sources', { num: sourcePaths.length })}
          {' '}
          {sourcePaths.slice(0, 3).join('、')}
          {sourcePaths.length > 3 ? ' …' : ''}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          value={angle.status}
          disabled={readOnly || isUpdating}
          onValueChange={value => onStatusChange(angle, value as AngleStatus)}
        >
          <SelectTrigger className="h-8 w-[9.5rem] text-xs" aria-label={t('angles.form.statusLabel')}>
            {isUpdating ? <Loader2 className="size-3.5 animate-spin" /> : null}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ANGLE_STATUS_ORDER.map(status => (
              <SelectItem key={status} value={status} className="text-xs">
                {t(`angles.status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!readOnly && (
          <>
            <Button variant="outline" size="sm" className="h-8" onClick={() => onDerive(angle)}>
              <GitBranch className="size-3.5" />
              {t('angles.action.derive')}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => onEdit(angle)}>
              <Pencil className="size-3.5" />
              {t('angles.action.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive"
              onClick={() => onDelete(angle)}
            >
              <Trash2 className="size-3.5" />
              {t('angles.action.delete')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
