/**
 * AngleFormDialog - 新建 / 派生 / 编辑方向共用的表单
 * slug 前端先按和项目英文名一样的规则校验一遍，重名也先挡一次，别等服务端退回来。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import { GitBranch, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ANGLE_DESC_MAX_LENGTH, ANGLE_NAME_MAX_LENGTH, ANGLE_STATUS_ORDER } from '@/api/angles/angle.constants'
import { AngleStatus } from '@/api/angles/angle.types'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { validateAngleDesc, validateAngleName, validateAngleSlug } from './angles.utils'

export interface AngleFormState {
  mode: 'create' | 'derive' | 'edit'
  /** derive 时是父方向，edit 时是被改的方向 */
  angle?: Angle
  /** derive 时给的 slug 建议 */
  suggestedSlug?: string
}

export interface AngleFormValues {
  slug: string
  name: string
  desc: string
  status: AngleStatus
}

interface AngleFormDialogProps {
  state: AngleFormState | null
  /** 项目里已经用掉的 slug，重名先在前端挡一次 */
  takenSlugs: string[]
  onOpenChange: (open: boolean) => void
  /** 返回 true 表示成功，对话框由这里关闭 */
  onSubmit: (state: AngleFormState, values: AngleFormValues) => Promise<boolean>
}

function getInitialValues(state: AngleFormState | null): AngleFormValues {
  if (!state)
    return { slug: '', name: '', desc: '', status: AngleStatus.Candidate }

  if (state.mode === 'edit' && state.angle) {
    return {
      slug: state.angle.slug,
      name: state.angle.name,
      desc: state.angle.desc || '',
      status: state.angle.status,
    }
  }

  return {
    slug: state.suggestedSlug || '',
    name: '',
    desc: '',
    status: AngleStatus.Candidate,
  }
}

export function AngleFormDialog({ state, takenSlugs, onOpenChange, onSubmit }: AngleFormDialogProps) {
  const { t } = useTransClient('projects')

  const [values, setValues] = useState<AngleFormValues>(getInitialValues(null))
  const [touched, setTouched] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (state) {
      setValues(getInitialValues(state))
      setTouched(false)
      setIsSubmitting(false)
    }
  }, [state])

  const isEdit = state?.mode === 'edit'
  const isDerive = state?.mode === 'derive'

  const slugErrorKey = isEdit
    ? null
    : validateAngleSlug(values.slug)
      || (takenSlugs.includes(values.slug.trim()) ? 'angles.slugError.taken' : null)
  const nameErrorKey = validateAngleName(values.name)
  const descErrorKey = validateAngleDesc(values.desc)
  const hasError = Boolean(slugErrorKey || nameErrorKey || descErrorKey)

  const setField = (key: 'slug' | 'name' | 'desc', value: string) => {
    setTouched(true)
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const setStatus = (status: AngleStatus) => {
    setTouched(true)
    setValues(prev => ({ ...prev, status }))
  }

  const handleSubmit = async () => {
    if (!state || hasError || isSubmitting)
      return

    setIsSubmitting(true)
    try {
      const ok = await onSubmit(state, {
        slug: values.slug.trim(),
        name: values.name.trim(),
        desc: values.desc.trim(),
        status: values.status,
      })
      if (ok)
        onOpenChange(false)
    }
    finally {
      setIsSubmitting(false)
    }
  }

  const titleKey = isEdit
    ? 'angles.form.editTitle'
    : isDerive
      ? 'angles.form.deriveTitle'
      : 'angles.form.createTitle'

  return (
    <Dialog open={Boolean(state)} onOpenChange={open => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('angles.form.editDesc')
              : isDerive
                ? t('angles.form.deriveDesc')
                : t('angles.form.createDesc')}
          </DialogDescription>
        </DialogHeader>

        {isDerive && state?.angle && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">
              {t('angles.form.parent', { name: state.angle.name, slug: state.angle.slug, interpolation: { escapeValue: false } })}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="angle-slug-input">{t('angles.form.slugLabel')}</Label>
            <Input
              id="angle-slug-input"
              value={values.slug}
              disabled={isEdit}
              autoFocus={!isEdit}
              placeholder={t('angles.form.slugPlaceholder')}
              onChange={event => setField('slug', event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? t('angles.form.slugFixed') : t('angles.form.slugHint')}
            </p>
            {touched && slugErrorKey && <p className="text-xs text-destructive">{t(slugErrorKey)}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="angle-name-input">{t('angles.form.nameLabel')}</Label>
            <Input
              id="angle-name-input"
              value={values.name}
              autoFocus={isEdit}
              maxLength={ANGLE_NAME_MAX_LENGTH}
              placeholder={t('angles.form.namePlaceholder')}
              onChange={event => setField('name', event.target.value)}
            />
            {touched && nameErrorKey && <p className="text-xs text-destructive">{t(nameErrorKey)}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="angle-desc-input">{t('angles.form.descLabel')}</Label>
            <Textarea
              id="angle-desc-input"
              className="min-h-24"
              value={values.desc}
              maxLength={ANGLE_DESC_MAX_LENGTH}
              placeholder={t('angles.form.descPlaceholder')}
              onChange={event => setField('desc', event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('angles.form.descHint')}</p>
            {touched && descErrorKey && <p className="text-xs text-destructive">{t(descErrorKey)}</p>}
          </div>

          {isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="angle-status-select">{t('angles.form.statusLabel')}</Label>
              <Select
                value={values.status}
                onValueChange={value => setStatus(value as AngleStatus)}
              >
                <SelectTrigger id="angle-status-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANGLE_STATUS_ORDER.map(status => (
                    <SelectItem key={status} value={status}>
                      {t(`angles.status.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            {t('angles.form.cancel')}
          </Button>
          <Button disabled={hasError || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? t('angles.form.submitSave') : isDerive ? t('angles.form.submitDerive') : t('angles.form.submitCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
