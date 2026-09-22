/**
 * PendingAngleCard - 待确认区里的一条方向
 * AI 起的名字和说明常常要改一笔才顺眼，所以采用之前能就地改；改完仍留在待确认区，点了采用才算数。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import { Check, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ANGLE_DESC_MAX_LENGTH, ANGLE_NAME_MAX_LENGTH } from '@/api/angles/angle.constants'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { validateAngleDesc, validateAngleName } from '../angles.utils'

interface PendingAngleCardProps {
  angle: Angle
  readOnly: boolean
  /** 这条卡片上有操作正在跑（采用 / 保存 / 删除），按钮全部禁用 */
  isBusy: boolean
  onConfirm: (angle: Angle) => void
  onSave: (angle: Angle, values: { name: string, desc: string }) => Promise<boolean>
  onDelete: (angle: Angle) => void
}

export function PendingAngleCard(props: PendingAngleCardProps) {
  const { angle, readOnly, isBusy, onConfirm, onSave, onDelete } = props
  const { t } = useTransClient('projects')

  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(angle.name)
  const [desc, setDesc] = useState(angle.desc ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [descError, setDescError] = useState<string | null>(null)

  const sourcePaths = angle.sourceAssetPaths ?? []

  const startEdit = () => {
    setName(angle.name)
    setDesc(angle.desc ?? '')
    setNameError(null)
    setDescError(null)
    setIsEditing(true)
  }

  const submit = async () => {
    const nameKey = validateAngleName(name)
    const descKey = validateAngleDesc(desc)
    setNameError(nameKey)
    setDescError(descKey)
    if (nameKey || descKey)
      return

    const ok = await onSave(angle, { name: name.trim(), desc: desc.trim() })
    if (ok)
      setIsEditing(false)
  }

  return (
    <div
      className="rounded-xl border border-dashed border-border bg-card px-4 py-3 transition-colors"
      data-testid={`pending-angle-card-${angle.slug}`}
    >
      {isEditing
        ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`pending-name-${angle.id}`} className="text-xs">
                  {t('angles.form.nameLabel')}
                </Label>
                <Input
                  id={`pending-name-${angle.id}`}
                  value={name}
                  maxLength={ANGLE_NAME_MAX_LENGTH}
                  placeholder={t('angles.form.namePlaceholder')}
                  onChange={event => setName(event.target.value)}
                />
                {nameError && <p className="text-xs text-destructive">{t(nameError)}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`pending-desc-${angle.id}`} className="text-xs">
                  {t('angles.form.descLabel')}
                </Label>
                <Textarea
                  id={`pending-desc-${angle.id}`}
                  value={desc}
                  rows={3}
                  maxLength={ANGLE_DESC_MAX_LENGTH}
                  placeholder={t('angles.form.descPlaceholder')}
                  onChange={event => setDesc(event.target.value)}
                />
                {descError && <p className="text-xs text-destructive">{t(descError)}</p>}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="h-8" disabled={isBusy} onClick={submit}>
                  {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {t('angles.form.submitSave')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  disabled={isBusy}
                  onClick={() => setIsEditing(false)}
                >
                  {t('angles.form.cancel')}
                </Button>
              </div>
            </div>
          )
        : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-medium text-foreground">{angle.name}</h4>
                <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {t(`angles.source.${angle.source}`)}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{angle.slug}</p>

              <p className="mt-2 text-sm text-muted-foreground">
                {angle.desc || t('angles.card.noDesc')}
              </p>

              {sourcePaths.length > 0 && (
                <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                  {t('angles.card.sources', { num: sourcePaths.length })}
                  {' '}
                  {sourcePaths.slice(0, 3).join('、')}
                  {sourcePaths.length > 3 ? ' …' : ''}
                </p>
              )}

              {!readOnly && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" className="h-8" disabled={isBusy} onClick={() => onConfirm(angle)}>
                    {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {t('angles.pending.confirm')}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8" disabled={isBusy} onClick={startEdit}>
                    <Pencil className="size-3.5" />
                    {t('angles.pending.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive hover:text-destructive"
                    disabled={isBusy}
                    onClick={() => onDelete(angle)}
                  >
                    <Trash2 className="size-3.5" />
                    {t('angles.action.delete')}
                  </Button>
                </div>
              )}
            </>
          )}
    </div>
  )
}
