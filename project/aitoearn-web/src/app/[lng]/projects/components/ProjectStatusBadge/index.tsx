/**
 * ProjectStatusBadge - 项目状态徽章
 * 项目列表卡片、详情页标题和基本信息共用一份，保证三处样式一致
 */
'use client'

import { ProjectStatus } from '@/api/projects/project.types'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/utils/className'

interface ProjectStatusBadgeProps {
  status: ProjectStatus
  className?: string
}

export function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
  const { t } = useTransClient('projects')
  const isArchived = status === ProjectStatus.Archived

  // 进行中沿用方向卡片的绿色口径，已归档用中性灰。
  // 原来跟着方向卡片一起写死 green-500/15 + green-600，亮色压卡片只有 2.90:1、压页面 2.79:1；
  // 两边一起换成 success 口径后 5.55:1（亮·卡片）/ 5.33:1（亮·页面）、7.48:1 / 8.27:1（暗）。
  return (
    <Badge
      variant={isArchived ? 'secondary' : 'outline'}
      className={cn(
        'shrink-0 font-medium',
        !isArchived && 'border-success/40 bg-success/10 text-success-text',
        className,
      )}
      data-testid={`project-status-${status}`}
    >
      {isArchived ? t('status.archived') : t('status.active')}
    </Badge>
  )
}
