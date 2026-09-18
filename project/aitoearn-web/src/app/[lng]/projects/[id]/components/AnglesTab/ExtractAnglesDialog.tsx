/**
 * ExtractAnglesDialog - 让 AI 从物料里提炼候选方向
 * 起一个带 projectName 的 Agent 任务，Agent 的工作目录就是这个项目的物料目录，
 * 它读 background/、写 angles/<slug>.md，过程实时显示，跑完刷新方向列表。
 */
'use client'

import { Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
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
import { buildExtractAnglesPrompt } from './angles.utils'
import { useProjectAgentTask } from './useProjectAgentTask'

interface ExtractAnglesDialogProps {
  open: boolean
  /** 项目英文名，同时是物料目录名 */
  projectName: string
  /** 已有的方向 slug，交给 AI 让它别提重复的 */
  existingSlugs: string[]
  onOpenChange: (open: boolean) => void
  /** 跑完刷新方向列表 */
  onFinished: () => void
}

export function ExtractAnglesDialog(props: ExtractAnglesDialogProps) {
  const { open, projectName, existingSlugs, onOpenChange, onFinished } = props
  const { t } = useTransClient('projects')

  const { status, logs, errorText, run, stop, reset } = useProjectAgentTask()
  const logBoxRef = useRef<HTMLDivElement>(null)

  // 关掉弹窗就把上一次的过程清掉，下次打开是干净的
  useEffect(() => {
    if (!open)
      reset()
  }, [open, reset])

  // 新日志滚到底
  useEffect(() => {
    const box = logBoxRef.current
    if (box)
      box.scrollTop = box.scrollHeight
  }, [logs])

  const isRunning = status === 'running'

  const handleStart = () => {
    run(
      {
        prompt: buildExtractAnglesPrompt(projectName, existingSlugs),
        projectName,
      },
      onFinished,
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 跑着的时候不让点外面关掉，免得以为已经停了
        if (!next && isRunning)
          return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('angles.extract.title')}</DialogTitle>
          <DialogDescription>{t('angles.extract.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('angles.extract.rule')}</span>
        </div>

        {status !== 'idle' && (
          <div
            ref={logBoxRef}
            className="max-h-56 min-h-24 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-muted-foreground"
          >
            {logs.length === 0 ? (
              <p>{isRunning ? t('angles.extract.waiting') : t('angles.extract.noLog')}</p>
            ) : (
              logs.map((line, index) => (
                <p key={`${index}-${line.slice(0, 12)}`} className="whitespace-pre-wrap break-words">
                  {line}
                </p>
              ))
            )}
          </div>
        )}

        {status === 'done' && (
          <p className="text-sm text-foreground">
            {t('angles.extract.done')}
            <span className="mt-1 block text-xs text-muted-foreground">
              {t('angles.extract.doneHint')}
            </span>
          </p>
        )}

        {status === 'error' && (
          <p className="text-sm text-destructive">
            {t('angles.extract.failed')}
            {errorText ? `：${errorText}` : ''}
          </p>
        )}

        <DialogFooter>
          {isRunning ? (
            <>
              <Button variant="outline" onClick={stop}>
                {t('angles.extract.stop')}
              </Button>
              <Button disabled>
                <Loader2 className="size-4 animate-spin" />
                {t('angles.extract.running')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('angles.extract.close')}
              </Button>
              <Button onClick={handleStart}>
                <Sparkles className="size-4" />
                {status === 'idle' ? t('angles.extract.start') : t('angles.extract.again')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
