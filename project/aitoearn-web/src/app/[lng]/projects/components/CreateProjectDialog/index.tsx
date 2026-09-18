/**
 * CreateProjectDialog - 新建项目对话框
 * 英文名前端实时校验 + 随机生成；失败按错误码给人话提示
 */
'use client'

import { Loader2, Shuffle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createProjectApi, suggestProjectNameApi } from '@/api/projects/project.api'
import {
  PROJECT_AUDIENCE_MAX_LENGTH,
  PROJECT_DESC_MAX_LENGTH,
  PROJECT_DISPLAY_NAME_MAX_LENGTH,
  PROJECT_GOAL_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
} from '@/api/projects/project.constants'
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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { getProjectErrorKey, validateProjectDisplayName, validateProjectName } from '../../projects.utils'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 创建成功回调，由父组件负责关闭与刷新 */
  onCreated: () => void
}

const EMPTY_FORM = {
  displayName: '',
  name: '',
  desc: '',
  audience: '',
  goal: '',
}

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const { t } = useTransClient('projects')

  const [form, setForm] = useState(EMPTY_FORM)
  const [nameTouched, setNameTouched] = useState(false)
  const [displayNameTouched, setDisplayNameTouched] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuggesting, setIsSuggesting] = useState(false)

  // 每次打开重置，避免上一次的输入和报错残留
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM)
      setNameTouched(false)
      setDisplayNameTouched(false)
      setIsSubmitting(false)
      setIsSuggesting(false)
    }
  }, [open])

  const nameErrorKey = validateProjectName(form.name)
  const displayNameErrorKey = validateProjectDisplayName(form.displayName)
  const canSubmit = !nameErrorKey && !displayNameErrorKey && !isSubmitting

  const setField = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  /** 随机生成一个当前可用的英文名 */
  const handleSuggestName = async () => {
    setIsSuggesting(true)
    try {
      const res = await suggestProjectNameApi()
      if (res && res.code === 0 && res.data?.name) {
        setField('name', res.data.name)
        setNameTouched(true)
      }
      else {
        toast.error(t('form.suggestFailed'))
      }
    }
    catch (error) {
      console.error('Suggest project name failed:', error)
      toast.error(t('form.suggestFailed'))
    }
    finally {
      setIsSuggesting(false)
    }
  }

  const handleSubmit = async () => {
    setNameTouched(true)
    setDisplayNameTouched(true)

    if (nameErrorKey || displayNameErrorKey)
      return

    setIsSubmitting(true)
    try {
      const res = await createProjectApi({
        name: form.name.trim(),
        displayName: form.displayName.trim(),
        desc: form.desc.trim() || undefined,
        audience: form.audience.trim() || undefined,
        goal: form.goal.trim() || undefined,
      })

      if (res && res.code === 0 && res.data) {
        toast.success(t('form.createSuccess'))
        onCreated()
        return
      }

      toast.error(t(getProjectErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Create project failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(560px,95vw)]">
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
          <DialogDescription>{t('form.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {/* 显示名 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-display-name">{t('label.displayName')}</Label>
            <Input
              id="project-display-name"
              value={form.displayName}
              maxLength={PROJECT_DISPLAY_NAME_MAX_LENGTH}
              placeholder={t('placeholder.displayName')}
              onChange={e => setField('displayName', e.target.value)}
              onBlur={() => setDisplayNameTouched(true)}
            />
            {displayNameTouched && displayNameErrorKey && (
              <p className="text-xs text-destructive">{t(displayNameErrorKey)}</p>
            )}
          </div>

          {/* 英文名 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">{t('label.name')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="project-name"
                value={form.name}
                maxLength={PROJECT_NAME_MAX_LENGTH}
                placeholder={t('placeholder.name')}
                className={cn(
                  'font-mono',
                  nameTouched && nameErrorKey && 'border-destructive focus-visible:ring-destructive',
                )}
                autoComplete="off"
                spellCheck={false}
                onChange={e => setField('name', e.target.value.trim().toLowerCase())}
                onBlur={() => setNameTouched(true)}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={isSuggesting}
                onClick={handleSuggestName}
              >
                {isSuggesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Shuffle className="size-4" />
                )}
                {t('form.suggest')}
              </Button>
            </div>
            {nameTouched && nameErrorKey && (
              <p className="text-xs text-destructive">{t(nameErrorKey)}</p>
            )}
            {/* 固定提示：创建后不可修改，同时是服务器上的目录名 */}
            <p className="text-xs text-muted-foreground">{t('form.nameHint')}</p>
          </div>

          {/* 一句话说明 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-desc">
              {t('label.desc')}
              <span className="ml-1 font-normal text-muted-foreground">{t('form.optional')}</span>
            </Label>
            <Textarea
              id="project-desc"
              value={form.desc}
              rows={2}
              maxLength={PROJECT_DESC_MAX_LENGTH}
              placeholder={t('placeholder.desc')}
              onChange={e => setField('desc', e.target.value)}
            />
          </div>

          {/* 面向谁 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-audience">
              {t('label.audience')}
              <span className="ml-1 font-normal text-muted-foreground">{t('form.optional')}</span>
            </Label>
            <Input
              id="project-audience"
              value={form.audience}
              maxLength={PROJECT_AUDIENCE_MAX_LENGTH}
              placeholder={t('placeholder.audience')}
              onChange={e => setField('audience', e.target.value)}
            />
          </div>

          {/* 想达成什么 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-goal">
              {t('label.goal')}
              <span className="ml-1 font-normal text-muted-foreground">{t('form.optional')}</span>
            </Label>
            <Input
              id="project-goal"
              value={form.goal}
              maxLength={PROJECT_GOAL_MAX_LENGTH}
              placeholder={t('placeholder.goal')}
              onChange={e => setField('goal', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('form.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? t('form.submitting') : t('form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
