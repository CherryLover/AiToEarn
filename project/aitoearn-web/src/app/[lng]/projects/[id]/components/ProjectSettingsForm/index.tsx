/**
 * ProjectSettingsForm - 项目可编辑字段
 * 只改显示名、说明、面向谁、想达成什么；英文名不提供修改入口
 * 建项目时填一次就够了，默认折叠，展开状态由详情页统一控制
 */
'use client'

import type { ProjectDetail } from '@/api/projects/project.types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { updateProjectApi } from '@/api/projects/project.api'
import {
  PROJECT_AUDIENCE_MAX_LENGTH,
  PROJECT_DESC_MAX_LENGTH,
  PROJECT_DISPLAY_NAME_MAX_LENGTH,
  PROJECT_GOAL_MAX_LENGTH,
} from '@/api/projects/project.constants'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/utils/ui/toast'
import { getProjectErrorKey, validateProjectDisplayName } from '../../../projects.utils'

interface ProjectSettingsFormProps {
  project: ProjectDetail
  /** 保存成功后把最新详情回传给页面 */
  onSaved: (project: ProjectDetail) => void
  disabled?: boolean
  /** 是否展开，由详情页记忆 */
  open: boolean
  onOpenChange: (open: boolean) => void
}

function toFormState(project: ProjectDetail) {
  return {
    displayName: project.displayName,
    desc: project.desc || '',
    audience: project.audience || '',
    goal: project.goal || '',
  }
}

export function ProjectSettingsForm(props: ProjectSettingsFormProps) {
  const { project, onSaved, disabled, open, onOpenChange } = props
  const { t } = useTransClient('projects')

  const initialForm = useMemo(() => toFormState(project), [project])
  const [form, setForm] = useState(initialForm)
  const [isSaving, setIsSaving] = useState(false)

  // 详情刷新后同步表单
  useEffect(() => {
    setForm(initialForm)
  }, [initialForm])

  const displayNameErrorKey = validateProjectDisplayName(form.displayName)
  const isDirty
    = form.displayName !== initialForm.displayName
      || form.desc !== initialForm.desc
      || form.audience !== initialForm.audience
      || form.goal !== initialForm.goal

  const setField = (key: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (displayNameErrorKey || !isDirty)
      return

    setIsSaving(true)
    try {
      const res = await updateProjectApi(project.id, {
        displayName: form.displayName.trim(),
        desc: form.desc.trim(),
        audience: form.audience.trim(),
        goal: form.goal.trim(),
      })

      if (res && res.code === 0 && res.data) {
        toast.success(t('detail.saveSuccess'))
        onSaved(res.data)
        return
      }

      toast.error(t(getProjectErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Update project failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsSaving(false)
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl border border-border bg-card"
    >
      <CollapsibleTrigger
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/40 md:px-5"
        data-testid="project-settings-toggle"
      >
        {open
          ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <h2 className="text-sm font-medium text-foreground">{t('detail.settings')}</h2>
      </CollapsibleTrigger>

      <CollapsibleContent className="px-4 pb-4 md:px-5 md:pb-5">
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          {t('detail.settingsDesc')}
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-detail-display-name">{t('label.displayName')}</Label>
            <Input
              id="project-detail-display-name"
              value={form.displayName}
              maxLength={PROJECT_DISPLAY_NAME_MAX_LENGTH}
              placeholder={t('placeholder.displayName')}
              disabled={disabled}
              onChange={e => setField('displayName', e.target.value)}
            />
            {displayNameErrorKey && (
              <p className="text-xs text-destructive">{t(displayNameErrorKey)}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-detail-desc">{t('label.desc')}</Label>
            <Textarea
              id="project-detail-desc"
              value={form.desc}
              rows={2}
              maxLength={PROJECT_DESC_MAX_LENGTH}
              placeholder={t('placeholder.desc')}
              disabled={disabled}
              onChange={e => setField('desc', e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-detail-audience">{t('label.audience')}</Label>
            <Input
              id="project-detail-audience"
              value={form.audience}
              maxLength={PROJECT_AUDIENCE_MAX_LENGTH}
              placeholder={t('placeholder.audience')}
              disabled={disabled}
              onChange={e => setField('audience', e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-detail-goal">{t('label.goal')}</Label>
            <Input
              id="project-detail-goal"
              value={form.goal}
              maxLength={PROJECT_GOAL_MAX_LENGTH}
              placeholder={t('placeholder.goal')}
              disabled={disabled}
              onChange={e => setField('goal', e.target.value)}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button
            onClick={handleSave}
            loading={isSaving}
            disabled={disabled || !isDirty || !!displayNameErrorKey}
          >
            {isSaving ? t('detail.saving') : t('detail.save')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setForm(initialForm)}
            disabled={disabled || !isDirty || isSaving}
          >
            {t('detail.reset')}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
