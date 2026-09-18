/**
 * TaskStatusBadge - 工单状态徽标
 * 设备卡片和工单列表共用，颜色口径统一在 devices.utils 里
 */
'use client'

import type { ExecutionTaskStatus } from '@/api/devices/execution-task.types'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/utils/className'
import { getTaskStatusClassName } from '../../devices.utils'

interface TaskStatusBadgeProps {
  status: ExecutionTaskStatus
  className?: string
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  const { t } = useTransClient('devices')

  return (
    <Badge variant="outline" className={cn(getTaskStatusClassName(status), className)}>
      {t(`taskStatus.${status}`)}
    </Badge>
  )
}
