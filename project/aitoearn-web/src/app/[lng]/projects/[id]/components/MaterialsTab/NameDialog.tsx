/**
 * NameDialog - 新建文件夹 / 改名共用的输入对话框
 * 名字前端先校验一遍，提交失败按错误码给人话提示
 */
'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { validateMaterialName } from './materials.utils'

export interface NameDialogState {
  mode: 'create-folder' | 'rename'
  /** 新建文件夹时是父目录，改名时是被改的对象 */
  path: string
  /** 改名时的初始值 */
  initialName: string
}

interface NameDialogProps {
  state: NameDialogState | null
  onOpenChange: (open: boolean) => void
  /** 返回 true 表示成功，对话框由父组件关闭 */
  onSubmit: (state: NameDialogState, name: string) => Promise<boolean>
}

export function NameDialog({ state, onOpenChange, onSubmit }: NameDialogProps) {
  const { t } = useTransClient('projects')

  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (state) {
      setName(state.initialName)
      setTouched(false)
      setIsSubmitting(false)
    }
  }, [state])

  const errorKey = validateMaterialName(name)
  const isCreate = state?.mode === 'create-folder'

  const handleSubmit = async () => {
    if (!state || errorKey || isSubmitting)
      return

    setIsSubmitting(true)
    try {
      const ok = await onSubmit(state, name.trim())
      if (ok)
        onOpenChange(false)
    }
    finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isCreate ? t('materials.newFolder.title') : t('materials.rename.title')}
          </DialogTitle>
          <DialogDescription>
            {isCreate
              ? t('materials.newFolder.desc', { dir: state?.path || '/', interpolation: { escapeValue: false } })
              : t('materials.rename.desc', { path: state?.path || '', interpolation: { escapeValue: false } })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-name-input">
            {isCreate ? t('materials.newFolder.label') : t('materials.rename.label')}
          </Label>
          <Input
            id="material-name-input"
            value={name}
            autoFocus
            placeholder={isCreate ? t('materials.newFolder.placeholder') : undefined}
            onChange={(event) => {
              setTouched(true)
              setName(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter')
                handleSubmit()
            }}
          />
          {touched && errorKey && <p className="text-xs text-destructive">{t(errorKey)}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button disabled={Boolean(errorKey) || isSubmitting} onClick={handleSubmit}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isCreate ? t('materials.newFolder.submit') : t('materials.rename.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
