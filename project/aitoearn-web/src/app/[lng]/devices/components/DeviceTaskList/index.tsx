/**
 * DeviceTaskList - 某台设备最近领过的工单
 * 只读，展示类型、状态、耗时和失败原因；展开设备卡片时才拉数据
 */
'use client'

import type { ExecutionTaskListItem } from '@/api/devices/execution-task.types'
import { useCallback, useEffect, useState } from 'react'
import { getExecutionTaskListApi } from '@/api/devices/execution-task.api'
import { useTransClient } from '@/app/i18n/client'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/utils/format'
import { getTaskDurationSeconds, normalizeExecutionTaskList } from '../../devices.utils'
import { TaskStatusBadge } from '../TaskStatusBadge'

interface DeviceTaskListProps {
  deviceId: string
}

/** 设备卡片里只看最近几条，要看全部去工单标签页 */
const RECENT_TASK_SIZE = 5

/** 骨架屏占位数量 */
const SKELETON_KEYS = ['s1', 's2', 's3']

export function DeviceTaskList({ deviceId }: DeviceTaskListProps) {
  const { t } = useTransClient('devices')

  const [tasks, setTasks] = useState<ExecutionTaskListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const loadTasks = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await getExecutionTaskListApi({ deviceId, page: 1, pageSize: RECENT_TASK_SIZE })
      if (res && res.code === 0) {
        setTasks(normalizeExecutionTaskList(res.data).slice(0, RECENT_TASK_SIZE))
        setFailed(false)
        return
      }
      setTasks([])
      setFailed(true)
    }
    catch (error) {
      console.error('Load device tasks failed:', error)
      setTasks([])
      setFailed(true)
    }
    finally {
      setIsLoading(false)
    }
  }, [deviceId])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {SKELETON_KEYS.map(key => (
          <Skeleton key={key} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (failed) {
    return <p className="text-sm text-muted-foreground">{t('device.recentTasks.loadFailed')}</p>
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('device.recentTasks.empty')}</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => {
        const duration = getTaskDurationSeconds(task.startedAt, task.finishedAt)

        return (
          <li
            key={task.id}
            className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">{t(`taskType.${task.type}`)}</span>
              <TaskStatusBadge status={task.status} />
              <span className="text-xs text-muted-foreground">
                {duration === null
                  ? t('tasks.durationPending')
                  : t('tasks.durationSeconds', { seconds: duration })}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatDate(task.createdAt)}
              </span>
            </div>
            {task.error && (
              <p className="line-clamp-2 text-xs text-destructive">{task.error}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
