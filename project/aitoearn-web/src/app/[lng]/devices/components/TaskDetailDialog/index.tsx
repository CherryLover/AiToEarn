/**
 * TaskDetailDialog - 工单详情
 * 载荷和结果按类型不同结构也不同，这里只做原样展示，不做二次解析
 */
'use client'

import type { Device } from '@/api/devices/device.types'
import type { ExecutionTaskDetail } from '@/api/devices/execution-task.types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getExecutionTaskDetailApi } from '@/api/devices/execution-task.api'
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
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/utils/format'
import { formatJsonBlock, getTaskDurationSeconds } from '../../devices.utils'
import { TaskStatusBadge } from '../TaskStatusBadge'

interface TaskDetailDialogProps {
  taskId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 设备列表，用来把 deviceId 显示成设备名 */
  devices: Device[]
}

export function TaskDetailDialog({ taskId, open, onOpenChange, devices }: TaskDetailDialogProps) {
  const { t } = useTransClient('devices')

  const deviceNameMap = useMemo(() => {
    const map = new Map<string, string>()
    devices.forEach(device => map.set(device.id, device.name))
    return map
  }, [devices])

  const [task, setTask] = useState<ExecutionTaskDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadDetail = useCallback(async (id: string) => {
    setIsLoading(true)
    try {
      const res = await getExecutionTaskDetailApi(id)
      setTask(res && res.code === 0 && res.data ? res.data : null)
    }
    catch (error) {
      console.error('Load execution task detail failed:', error)
      setTask(null)
    }
    finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !taskId) {
      setTask(null)
      return
    }
    loadDetail(taskId)
  }, [open, taskId, loadDetail])

  const duration = task ? getTaskDurationSeconds(task.startedAt, task.finishedAt) : null

  // 谁在干这活：领走的设备优先，其次是指定设备，都没有就是任意合格设备
  const taskDeviceId = task ? task.deviceId || task.targetDeviceId : null
  const deviceLabel = taskDeviceId
    ? deviceNameMap.get(taskDeviceId) || t('tasks.unknownDevice')
    : t('tasks.anyDevice')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(640px,95vw)]">
        <DialogHeader>
          <DialogTitle>{t('detail.title')}</DialogTitle>
          <DialogDescription>{t('detail.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </>
          ) : !task ? (
            <p className="text-sm text-muted-foreground">{t('detail.loadFailed')}</p>
          ) : (
            <>
              {/* 概况 */}
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {t(`taskType.${task.type}`)}
                  </span>
                  <TaskStatusBadge status={task.status} />
                  <span className="text-xs text-muted-foreground">
                    {t(`taskMode.${task.mode}`)}
                  </span>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div className="flex gap-1">
                    <dt>{t('detail.attempts')}</dt>
                    <dd className="text-foreground">{`${task.attempts} / ${task.maxAttempts}`}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t('detail.duration')}</dt>
                    <dd className="text-foreground">
                      {duration === null
                        ? t('detail.durationPending')
                        : t('detail.durationValue', { seconds: duration })}
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t('detail.createdAt')}</dt>
                    <dd className="text-foreground">{formatDate(task.createdAt)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t('detail.availableAt')}</dt>
                    <dd className="text-foreground">{formatDate(task.availableAt)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t('detail.device')}</dt>
                    <dd className="text-foreground">{deviceLabel}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t('detail.capability')}</dt>
                    <dd className="text-foreground">
                      {task.requiredCapability || t('detail.noCapability')}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* 失败原因 */}
              {task.error && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium text-foreground">{t('detail.error')}</p>
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {task.error}
                  </p>
                </div>
              )}

              {/* 载荷 */}
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-foreground">{t('detail.payload')}</p>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
                  {formatJsonBlock(task.payload)}
                </pre>
              </div>

              {/* 结果 */}
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-foreground">{t('detail.result')}</p>
                {task.result ? (
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
                    {formatJsonBlock(task.result)}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('detail.noResult')}</p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('action.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
