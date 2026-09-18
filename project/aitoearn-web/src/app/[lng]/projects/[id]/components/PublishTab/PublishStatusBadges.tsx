/**
 * PublishStatusBadges - 发布状态 + 链接状态
 * 两个维度分开显示：「发成功了但没拿到链接」是真实会发生的情况，合成一个字段就成了模糊地带。
 */
'use client'

import type { LinkStatus, PublishStatus } from '@/api/publishing/publishing.types'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/utils/className'
import { getLinkStatusClassName, getPublishStatusClassName } from './publish.utils'

export function PublishStatusBadge({
  status,
  className,
}: {
  status: PublishStatus
  className?: string
}) {
  const { t } = useTransClient('projects')

  return (
    <Badge variant="outline" className={cn(getPublishStatusClassName(status), className)}>
      {t(`publish.publishStatus.${status}`)}
    </Badge>
  )
}

export function LinkStatusBadge({
  status,
  className,
}: {
  status: LinkStatus
  className?: string
}) {
  const { t } = useTransClient('projects')

  return (
    <Badge variant="outline" className={cn(getLinkStatusClassName(status), className)}>
      {t(`publish.linkStatus.${status}`)}
    </Badge>
  )
}
