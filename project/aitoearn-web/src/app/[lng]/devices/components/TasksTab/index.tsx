/**
 * TasksTab - 工单列表标签页
 * 按状态 / 类型 / 设备筛，能看载荷和结果，失败的一键重试，还能手动建 echo 工单打通链路
 */
'use client'

import type { Device } from '@/api/devices/device.types'
import type { ExecutionTaskListItem } from '@/api/devices/execution-task.types'
import { ClipboardList, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelExecutionTaskApi,
  getExecutionTaskListApi,
  retryExecutionTaskApi,
} from '@/api/devices/execution-task.api'
import { EXECUTION_TASK_PAGE_SIZE } from '@/api/devices/execution-task.constants'
import {
  ExecutionTaskMode,
  ExecutionTaskStatus,
  ExecutionTaskType,
} from '@/api/devices/execution-task.types'
import { useTransClient } from '@/app/i18n/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/utils/format'
import { toast } from '@/utils/ui/toast'
import {
  getDeviceErrorKey,
  getTaskDurationSeconds,
  isActiveTask,
  normalizeExecutionTaskList,
} from '../../devices.utils'
import { CreateEchoDialog } from '../CreateEchoDialog'
import { TaskDetailDialog } from '../TaskDetailDialog'
import { TaskStatusBadge } from '../TaskStatusBadge'

interface TasksTabProps {
  /** 设备列表，用来把 deviceId 显示成设备名，也给筛选和建单用 */
  devices: Device[]
}

/** 筛选里的「全部」取值，提交时转成不传该字段 */
const ALL_VALUE = 'all'

/** 还有活在跑时的轮询间隔（毫秒），够盯住 echo 链路又不至于太吵 */
const ACTIVE_POLL_INTERVAL = 8000

/** 骨架屏占位数量 */
const SKELETON_KEYS = ['s1', 's2', 's3', 's4']

const STATUS_OPTIONS = Object.values(ExecutionTaskStatus)
const TYPE_OPTIONS = Object.values(ExecutionTaskType)

export function TasksTab({ devices }: TasksTabProps) {
  const { t } = useTransClient('devices')

  const [tasks, setTasks] = useState<ExecutionTaskListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE)
  const [typeFilter, setTypeFilter] = useState<string>(ALL_VALUE)
  const [deviceFilter, setDeviceFilter] = useState<string>(ALL_VALUE)
  const [echoOpen, setEchoOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ExecutionTaskListItem | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  // 轮询用的静默刷新不该打断正在看的骨架屏，也不该反复弹错误
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const deviceNameMap = useMemo(() => {
    const map = new Map<string, string>()
    devices.forEach(device => map.set(device.id, device.name))
    return map
  }, [devices])

  /** 谁在干这活：领走的设备优先，其次是指定设备，都没有就是任意合格设备 */
  const getTaskDeviceLabel = (task: ExecutionTaskListItem) => {
    const deviceId = task.deviceId || task.targetDeviceId
    if (!deviceId)
      return t('tasks.anyDevice')

    return deviceNameMap.get(deviceId) || t('tasks.unknownDevice')
  }

  const loadTasks = useCallback(
    async (silentRefresh = false) => {
      if (!silentRefresh)
        setIsLoading(true)

      try {
        const res = await getExecutionTaskListApi({
          status: statusFilter === ALL_VALUE ? undefined : (statusFilter as ExecutionTaskStatus),
          type: typeFilter === ALL_VALUE ? undefined : (typeFilter as ExecutionTaskType),
          deviceId: deviceFilter === ALL_VALUE ? undefined : deviceFilter,
          page: 1,
          pageSize: EXECUTION_TASK_PAGE_SIZE,
        })

        if (!isMountedRef.current)
          return

        if (res && res.code === 0) {
          setTasks(normalizeExecutionTaskList(res.data))
          return
        }

        setTasks([])
        if (!silentRefresh)
          toast.error(t('tasks.loadFailed'))
      }
      catch (error) {
        console.error('Load execution task list failed:', error)
        if (!isMountedRef.current)
          return
        setTasks([])
        if (!silentRefresh)
          toast.error(t('tasks.loadFailed'))
      }
      finally {
        if (isMountedRef.current && !silentRefresh)
          setIsLoading(false)
      }
    },
    [statusFilter, typeFilter, deviceFilter, t],
  )

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const hasActiveTask = tasks.some(task => isActiveTask(task.status))

  // 有活在跑就自动刷新，跑完了就停下来，不做无谓的请求
  useEffect(() => {
    if (!hasActiveTask)
      return

    const timer = setInterval(() => {
      loadTasks(true)
    }, ACTIVE_POLL_INTERVAL)

    return () => clearInterval(timer)
  }, [hasActiveTask, loadTasks])

  const handleRetry = async (task: ExecutionTaskListItem) => {
    setPendingId(task.id)
    try {
      const res = await retryExecutionTaskApi(task.id)
      if (res && res.code === 0) {
        toast.success(t('tasks.retrySuccess'))
        loadTasks(true)
        return
      }
      toast.error(t(getDeviceErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Retry execution task failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setPendingId(null)
    }
  }

  const handleCancel = async () => {
    if (!cancelTarget)
      return

    setPendingId(cancelTarget.id)
    try {
      const res = await cancelExecutionTaskApi(cancelTarget.id)
      if (res && res.code === 0) {
        toast.success(t('tasks.cancelSuccess'))
        setCancelTarget(null)
        loadTasks(true)
        return
      }
      toast.error(t(getDeviceErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Cancel execution task failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setPendingId(null)
    }
  }

  const isEmpty = !isLoading && tasks.length === 0

  return (
    <div className="flex flex-col gap-4">
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>{t('tasks.filter.allStatus')}</SelectItem>
            {STATUS_OPTIONS.map(status => (
              <SelectItem key={status} value={status}>
                {t(`taskStatus.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>{t('tasks.filter.allType')}</SelectItem>
            {TYPE_OPTIONS.map(type => (
              <SelectItem key={type} value={type}>
                {t(`taskType.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={deviceFilter} onValueChange={setDeviceFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>{t('tasks.filter.allDevice')}</SelectItem>
            {devices.map(device => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => loadTasks()}
          disabled={isLoading}
        >
          <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          {t('action.refresh')}
        </Button>
        <Button size="sm" onClick={() => setEchoOpen(true)}>
          <Plus className="size-4" />
          {t('action.createEcho')}
        </Button>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {SKELETON_KEYS.map(key => (
            <Skeleton key={key} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ClipboardList className="size-6" />
          </div>
          <h3 className="text-base font-medium text-foreground">{t('tasks.empty.title')}</h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t('tasks.empty.desc')}
          </p>
          <Button className="mt-6" onClick={() => setEchoOpen(true)}>
            <Plus className="size-4" />
            {t('action.createEcho')}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const duration = getTaskDurationSeconds(task.startedAt, task.finishedAt)
            const active = isActiveTask(task.status)
            // 只有失败的能重试：服务端 updateAsPendingForRetryById 只认 failed，
            // 给已取消的也放出按钮，点下去必然拿到 ExecutionTaskRetryNotAllowed
            const canRetry = task.status === ExecutionTaskStatus.Failed
            const isPending = pendingId === task.id

            return (
              <li
                key={task.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3"
                data-testid={`execution-task-${task.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {t(`taskType.${task.type}`)}
                  </span>
                  <TaskStatusBadge status={task.status} />
                  {task.mode === ExecutionTaskMode.Manual && (
                    <span className="text-xs text-muted-foreground">{t('taskMode.manual')}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(task.createdAt)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t('tasks.column.device', {
                      device: getTaskDeviceLabel(task),
                    })}
                  </span>
                  <span>
                    {t('tasks.column.attempts', {
                      attempts: task.attempts,
                      maxAttempts: task.maxAttempts,
                    })}
                  </span>
                  <span>
                    {duration === null
                      ? t('tasks.durationPending')
                      : t('tasks.durationSeconds', { seconds: duration })}
                  </span>
                </div>

                {task.error && (
                  <p className="line-clamp-2 text-xs text-destructive">{task.error}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(task.id)}>
                    {t('action.detail')}
                  </Button>
                  {canRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleRetry(task)}
                    >
                      {t('action.retry')}
                    </Button>
                  )}
                  {active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setCancelTarget(task)}
                    >
                      {t('action.cancelTask')}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 手动建 echo 工单 */}
      <CreateEchoDialog
        open={echoOpen}
        onOpenChange={setEchoOpen}
        devices={devices}
        onCreated={() => loadTasks(true)}
      />

      {/* 详情 */}
      <TaskDetailDialog
        taskId={detailId}
        devices={devices}
        open={Boolean(detailId)}
        onOpenChange={(next) => {
          if (!next)
            setDetailId(null)
        }}
      />

      {/* 取消二次确认 */}
      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(next) => {
          if (!next)
            setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tasks.cancelConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('tasks.cancelConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(pendingId)}>
              {t('action.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(pendingId)}
              onClick={(event) => {
                // 交给异步流程控制关闭时机，避免请求没回来就把弹窗关了
                event.preventDefault()
                handleCancel()
              }}
            >
              {t('action.cancelTask')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
