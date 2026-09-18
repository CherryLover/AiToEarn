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

  // 进行中沿用方向卡片的绿色口径，已归档用中性灰
  return (
    <Badge
      variant={isArchived ? 'secondary' : 'outline'}
      className={cn(
        'shrink-0 font-medium',
        !isArchived && 'border-transparent bg-green-500/15 text-green-600 dark:text-green-400',
        className,
      )}
      data-testid={`project-status-${status}`}
    >
      {isArchived ? t('status.archived') : t('status.active')}
    </Badge>
  )
}
