/**
 * GenerateDraftPanel - 选方向 + 选平台 → 生成一条内容
 * 起一个带 projectName 的 Agent 任务，它在项目物料目录里读方向和物料、写 drafts/。
 * 没有方向就先去「方向」标签页提炼，这里只提示，不越权替人建。
 */
'use client'

import type { Angle } from '@/api/angles/angle.types'
import { Loader2, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AngleStatus } from '@/api/angles/angle.types'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useProjectAgentTask } from '../AnglesTab/useProjectAgentTask'
import { DEFAULT_DRAFT_PLATFORM, DRAFT_PLATFORMS } from './drafts.constants'
import { buildDraftPrompt } from './drafts.utils'

interface GenerateDraftPanelProps {
  /** 项目英文名，AI 任务靠它锁定工作目录 */
  projectName: string
  angles: Angle[]
  isAnglesLoading: boolean
  readOnly: boolean
  /** 生成完刷新草稿列表 */
  onFinished: () => void
}

export function GenerateDraftPanel(props: GenerateDraftPanelProps) {
  const { projectName, angles, isAnglesLoading, readOnly, onFinished } = props
  const { t } = useTransClient('projects')

  const { status, logs, errorText, run, stop } = useProjectAgentTask()

  const [angleId, setAngleId] = useState('')
  const [platform, setPlatform] = useState<string>(DEFAULT_DRAFT_PLATFORM)
  const [extra, setExtra] = useState('')

  // 已淘汰的方向不该再拿去生成内容
  const usableAngles = useMemo(
    () => angles.filter(angle => angle.status !== AngleStatus.Retired),
    [angles],
  )

  const selectedAngle = usableAngles.find(angle => angle.id === angleId) ?? null
  const isRunning = status === 'running'

  const handleGenerate = () => {
    if (!selectedAngle)
      return

    run(
      {
        prompt: buildDraftPrompt({
          projectName,
          angleSlug: selectedAngle.slug,
          angleName: selectedAngle.name,
          platform,
          extra,
        }),
        projectName,
      },
      onFinished,
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{t('drafts.generate.title')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('drafts.generate.desc')}</p>
        </div>
      </div>

      {usableAngles.length === 0 && !isAnglesLoading ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t('drafts.generate.noAngles')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="draft-angle-select">{t('drafts.generate.angleLabel')}</Label>
              <Select
                value={angleId}
                disabled={readOnly || isRunning || isAnglesLoading}
                onValueChange={setAngleId}
              >
                <SelectTrigger id="draft-angle-select">
                  <SelectValue placeholder={t('drafts.generate.anglePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {usableAngles.map(angle => (
                    <SelectItem key={angle.id} value={angle.id}>
                      {angle.name}
                      {' · '}
                      {angle.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="draft-platform-select">{t('drafts.generate.platformLabel')}</Label>
              <Select
                value={platform}
                disabled={readOnly || isRunning}
                onValueChange={setPlatform}
              >
                <SelectTrigger id="draft-platform-select">
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
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t(`drafts.platformRule.${platform}`)}</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="draft-extra-input">{t('drafts.generate.extraLabel')}</Label>
            <Textarea
              id="draft-extra-input"
              className="min-h-16"
              value={extra}
              disabled={readOnly || isRunning}
              placeholder={t('drafts.generate.extraPlaceholder')}
              onChange={event => setExtra(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isRunning ? (
              <>
                <Button disabled>
                  <Loader2 className="size-4 animate-spin" />
                  {t('drafts.generate.running')}
                </Button>
                <Button variant="outline" onClick={stop}>
                  {t('drafts.generate.stop')}
                </Button>
              </>
            ) : (
              <Button disabled={readOnly || !selectedAngle} onClick={handleGenerate}>
                <Sparkles className="size-4" />
                {t('drafts.generate.submit')}
              </Button>
            )}

            {status === 'done' && (
              <span className="text-xs text-muted-foreground">{t('drafts.generate.done')}</span>
            )}
            {status === 'error' && (
              <span className="text-xs text-destructive">
                {t('drafts.generate.failed')}
                {errorText ? `：${errorText}` : ''}
              </span>
            )}
          </div>

          {status !== 'idle' && (
            <div className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {logs.length === 0 ? (
                <p>{isRunning ? t('drafts.generate.waiting') : t('drafts.generate.noLog')}</p>
              ) : (
                logs.map((line, index) => (
                  <p
                    key={`${index}-${line.slice(0, 12)}`}
                    className="whitespace-pre-wrap break-words"
                  >
                    {line}
                  </p>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
