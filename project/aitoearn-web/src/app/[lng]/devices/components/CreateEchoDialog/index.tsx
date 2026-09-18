/**
 * CreateEchoDialog - 手动建一个 echo 工单
 * 打通「网页下单 → 插件领活 → 回报结果」这条链路时最直接的工具：
 * 选项目、写一句话、可选指定设备，建完在工单列表里盯状态就行
 */
'use client'

import type { Device } from '@/api/devices/device.types'
import type { ProjectListItem } from '@/api/projects/project.types'
import { useCallback, useEffect, useState } from 'react'
import { createEchoTaskApi } from '@/api/devices/execution-task.api'
import { ECHO_MESSAGE_MAX_LENGTH } from '@/api/devices/execution-task.constants'
import { getProjectListApi } from '@/api/projects/project.api'
import { ProjectStatus } from '@/api/projects/project.types'
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
import { toast } from '@/utils/ui/toast'
import { getDeviceErrorKey } from '../../devices.utils'

interface CreateEchoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 可选指定设备时的候选，取自设备列表 */
  devices: Device[]
  /** 建单成功回调，由父组件刷新工单列表 */
  onCreated: () => void
}

/** 「任意合格设备」在下拉里的取值，提交时转成不传 deviceId */
const ANY_DEVICE_VALUE = 'any'

/** 默认文本，直接能建单，不用想写什么 */
const DEFAULT_MESSAGE = 'hello from web'

export function CreateEchoDialog({
  open,
  onOpenChange,
  devices,
  onCreated,
}: CreateEchoDialogProps) {
  const { t } = useTransClient('devices')

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [isProjectsLoading, setIsProjectsLoading] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [deviceId, setDeviceId] = useState(ANY_DEVICE_VALUE)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [isSubmitting, setIsSubmitting] = useState(false)

  /** 只列进行中的项目，归档项目不能派活 */
  const loadProjects = useCallback(async () => {
    setIsProjectsLoading(true)
    try {
      const res = await getProjectListApi(ProjectStatus.Active)
      if (res && res.code === 0 && Array.isArray(res.data)) {
        setProjects(res.data)
        setProjectId(prev => prev || res.data[0]?.id || '')
        return
      }
      setProjects([])
      toast.error(t('echo.loadProjectFailed'))
    }
    catch (error) {
      console.error('Load project list failed:', error)
      setProjects([])
      toast.error(t('echo.loadProjectFailed'))
    }
    finally {
      setIsProjectsLoading(false)
    }
  }, [t])

  // 每次打开重置输入并重新拉项目，项目可能刚建出来
  useEffect(() => {
    if (!open)
      return

    setMessage(DEFAULT_MESSAGE)
    setDeviceId(ANY_DEVICE_VALUE)
    setIsSubmitting(false)
    loadProjects()
  }, [open, loadProjects])

  const trimmedMessage = message.trim()
  const canSubmit = Boolean(projectId) && trimmedMessage.length > 0 && !isSubmitting

  const handleSubmit = async () => {
    if (!canSubmit)
      return

    setIsSubmitting(true)
    try {
      const res = await createEchoTaskApi({
        projectId,
        message: trimmedMessage,
        targetDeviceId: deviceId === ANY_DEVICE_VALUE ? undefined : deviceId,
      })

      if (res && res.code === 0) {
        toast.success(t('echo.success'))
        onCreated()
        onOpenChange(false)
        return
      }

      toast.error(t(getDeviceErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Create echo task failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsSubmitting(false)
    }
  }

  const hasProject = projects.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(480px,95vw)]">
        <DialogHeader>
          <DialogTitle>{t('echo.title')}</DialogTitle>
          <DialogDescription>{t('echo.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 属于哪个项目 */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('echo.project')}</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!hasProject}>
              <SelectTrigger>
                <SelectValue placeholder={t('echo.projectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isProjectsLoading && !hasProject && (
              <p className="text-xs text-destructive">{t('echo.noProject')}</p>
            )}
          </div>

          {/* 回传什么 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="echo-message">{t('echo.message')}</Label>
            <Input
              id="echo-message"
              value={message}
              maxLength={ECHO_MESSAGE_MAX_LENGTH}
              placeholder={t('echo.messagePlaceholder')}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          {/* 指定设备 */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('echo.device')}</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_DEVICE_VALUE}>{t('echo.deviceAny')}</SelectItem>
                {devices.map(device => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('action.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? t('echo.submitting') : t('echo.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
