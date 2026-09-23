/**
 * GenerateDraftDialog - 盯着一个方向，就地把「照这个方向写一条」交代出去
 *
 * 方向已经定了，这里只问还缺的两件事：发哪个平台、有没有额外要求。
 * 确认之后把话丢进右侧那条项目对话，真正干活在那边。
 *
 * 为什么是就地弹框而不是跳到「生成」页再填：方向是在方向列表里挑的，
 * 挑完被弹到另一个页面重新填一遍表，中间那一跳没帮上任何忙。
 * 填完再切过去，那一跳才有意义——你能看见结果待会儿落在哪。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import { Sparkles } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_DRAFT_PLATFORM, DRAFT_PLATFORMS } from './drafts.constants'
import { buildDraftPrompt } from './drafts.utils'

interface GenerateDraftDialogProps {
  /** 要生成的方向；null 表示不开 */
  angle: Angle | null
  /** 项目英文名，拼进提示词里 */
  projectName: string
  onOpenChange: (open: boolean) => void
  /** 确认后把拼好的一句话交出去 */
  onSubmit: (prompt: string) => void
}

export function GenerateDraftDialog(props: GenerateDraftDialogProps) {
  const { angle, projectName, onOpenChange, onSubmit } = props
  const { t } = useTransClient('projects')

  const [platform, setPlatform] = useState<string>(DEFAULT_DRAFT_PLATFORM)
  const [extra, setExtra] = useState('')

  // 每次换一个方向重开都从干净状态开始，别把上一条的补充要求带过来
  useEffect(() => {
    if (angle) {
      setPlatform(DEFAULT_DRAFT_PLATFORM)
      setExtra('')
    }
  }, [angle])

  const handleSubmit = () => {
    if (!angle)
      return

    onSubmit(buildDraftPrompt({
      projectName,
      angleSlug: angle.slug,
      angleName: angle.name,
      platform,
      extra,
    }))
    onOpenChange(false)
  }

  return (
    <Dialog open={Boolean(angle)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('drafts.generate.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('drafts.generate.dialogDesc')}</DialogDescription>
        </DialogHeader>

        {/* 方向是带过来的，这里只给人确认一眼，不给改——要换方向就回列表里点别的那张卡 */}
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">{t('drafts.generate.angleLabel')}</p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">{angle?.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{angle?.slug}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="generate-dialog-platform">{t('drafts.generate.platformLabel')}</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger id="generate-dialog-platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DRAFT_PLATFORMS.map(item => (
                <SelectItem key={item.value} value={item.value}>
                  {t(`drafts.platform.${item.value}`)}
                  {item.recommended ? ` · ${t('drafts.generate.recommended')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t(`drafts.platformRule.${platform}`)}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="generate-dialog-extra">{t('drafts.generate.extraLabel')}</Label>
          <Textarea
            id="generate-dialog-extra"
            className="min-h-16"
            value={extra}
            placeholder={t('drafts.generate.extraPlaceholder')}
            onChange={event => setExtra(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('drafts.generate.dialogCancel')}
          </Button>
          <Button onClick={handleSubmit}>
            <Sparkles className="size-4" />
            {t('drafts.generate.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
