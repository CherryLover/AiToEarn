/**
 * TaskCard - 任务卡片组件
 * 功能：显示任务简要信息，支持点击跳转到对话详情
 */

'use client'

import type React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Heart,
  Loader2,
  MessageSquare,
  Share2,
  Star,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/utils/className'
import { formatRelativeTime } from '@/utils/format'

export interface ITaskCardProps {
  /** 任务ID */
  id: string
  /** 任务标题 */
  title: string
  /** 任务状态（英文原始状态字符串） */
  status?: string
  /** 创建时间 */
  createdAt: string | number
  /** 更新时间 */
  updatedAt?: string | number
  /** 任务评分（1-5） */
  rating?: number | null
  /** 是否已收藏 */
  isFavorited?: boolean
  /** 收藏加载中 */
  isFavoriteLoading?: boolean
  /** 删除回调 */
  onDelete?: (id: string) => void | Promise<void>
  /** 评分回调（用于历史列表触发外部评分弹窗） */
  onRateClick?: (taskId: string) => void
  /** 选择回调（如果提供，点击卡片将触发选择而不是跳转） */
  onSelect?: (id: string) => void
  /** 在主页展示内联评分控件 */
  showInlineRating?: boolean
  /** 自定义类名 */
  className?: string
  /** 分享回调（由父组件触发 ShareModal） */
  onShare?: (id: string) => void
  /** 收藏切换回调 */
  onFavoriteToggle?: (id: string, isFavorited: boolean) => void | Promise<void>
}

/** 获取状态显示配置 */
// 四支状态徽章原来是写死的 *-100/*-700，亮色擦着线过（4.51~5.49:1），
// 和同文件下面那颗已经换成 text-destructive 的收藏红心不是一套色。
// 统一走语义变量后：requiresAction 5.18:1（亮）/ 6.55:1（暗）、completed 5.55 / 7.48、
// running 5.74 / 5.63、failed 4.78 / 5.45，正文门槛 4.5:1 都过。
function getStatusConfig(status: string | undefined, t: (key: string) => string) {
  const normalizedStatus = status?.toLowerCase()

  switch (normalizedStatus) {
    case 'requires_action':
      return {
        label: t('task.status.requiresAction') || 'Requires Action',
        className: 'border-warning/30 bg-warning/10 text-warning-text',
        icon: AlertCircle,
      }
    case 'completed':
      return {
        label: t('task.status.completed') || 'Completed',
        className: 'border-success/40 bg-success/10 text-success-text',
        icon: CheckCircle2,
      }
    case 'running':
      return {
        label: t('task.status.running') || 'Running',
        className: 'border-info/30 bg-info/10 text-info',
        icon: Loader2,
      }
    case 'error':
    case 'failed':
      return {
        label: t('task.status.failed') || 'Failed',
        className: 'border-destructive/30 bg-destructive/10 text-destructive',
        icon: AlertCircle,
      }
    default:
      return {
        label: status || '',
        className: 'bg-muted text-muted-foreground border-border',
        icon: null,
      }
  }
}

/**
 * TaskCard - 任务卡片组件
 */
export function TaskCard({
  id,
  title,
  status,
  createdAt,
  updatedAt,
  rating,
  isFavorited = false,
  isFavoriteLoading = false,
  onDelete,
  className,
  onSelect,
  onRateClick,
  onShare,
  onFavoriteToggle,
}: ITaskCardProps) {
  const router = useRouter()
  const { t } = useTransClient('chat')
  const [isDeleting, setIsDeleting] = useState(false)

  const statusConfig = getStatusConfig(status, t as (key: string) => string)

  /** 跳转到对话详情页 */
  const handleClick = () => {
    if (isDeleting)
      return
    if (onSelect) {
      onSelect(id)
      return
    }
    router.push(`/chat/${id}`)
  }

  /** 处理删除 */
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!onDelete || isDeleting)
      return

    try {
      setIsDeleting(true)
      await onDelete(id)
    }
    finally {
      setIsDeleting(false)
    }
  }

  /** 触发评分回调（由历史列表等外部组件使用） */
  const handleRateClick = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    e?.preventDefault()
    if (!onRateClick)
      return
    onRateClick(id)
  }

  const handleShareClick = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    e?.preventDefault()
    if (typeof onShare === 'function')
      onShare(id)
  }

  /** 处理收藏切换 */
  const handleFavoriteToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (isFavoriteLoading)
      return
    onFavoriteToggle?.(id, !isFavorited)
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        'flex flex-col p-4 rounded-xl border border-border bg-card cursor-pointer transition-all',
        'hover:border-border hover:shadow-md',
        isDeleting && 'opacity-60 cursor-wait',
        className,
      )}
    >
      {/* 图标 + 标题 */}
      <div className="flex items-start gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
        </div>
        <h4 title={title} className="text-sm font-medium text-foreground truncate flex-1 pt-1">
          {title || 'New Chat'}
        </h4>
      </div>

      {/* 时间 & 状态 */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(new Date(updatedAt || createdAt))}
        </span>
        {status && statusConfig.label && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 sm:px-2 py-0.5 text-[11px] font-medium shrink-0',
              statusConfig.className,
            )}
            title={statusConfig.label}
          >
            {statusConfig.icon && (
              <statusConfig.icon
                className={cn('w-3 h-3', status?.toLowerCase() === 'running' && 'animate-spin')}
              />
            )}
            {/* 移动端只显示图标，桌面端显示文字 */}
            <span className="hidden sm:inline">{statusConfig.label}</span>
          </span>
        )}
      </div>

      {/* Action buttons: 收藏 + 评分 + 分享 + 删除 - 只显示图标 + Tooltip */}
      <TooltipProvider delayDuration={300}>
        <div className="mt-3 flex items-center justify-end gap-1">
          {/* 收藏按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleFavoriteToggle}
                disabled={isFavoriteLoading}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={isFavorited ? t('task.unfavorite') : t('task.favorite')}
              >
                {isFavoriteLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Heart
                    className={cn(
                      'w-4 h-4 transition-colors',
                      // 高亮态也走主题变量，别和父级的 text-muted-foreground 混用两套色。
                      // 按钮上原来挂着 opacity-60，叠加后红心只剩 2.74:1（亮）/ 3.17:1（暗），图标门槛 3:1 不过。
                      // 去掉那层不透明度后是 5.56:1（亮）/ 6.42:1（暗）——这才是实际渲染出来的值。
                      isFavorited && 'text-destructive fill-destructive',
                    )}
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isFavorited ? t('task.unfavorite') : t('task.favorite')}
            </TooltipContent>
          </Tooltip>

          {/* 评分按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRateClick}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={t('task.rate')}
              >
                <Star
                  className={cn(
                    'w-4 h-4 transition-colors',
                    // 同 star-rating：写死 amber-400 亮色下只有 1.67:1，--warning 当文字也只有 3.19:1；
                    // --chart-4 是调色板里唯一亮暗都过 4.5:1 的金色。
                    // 这里给的是叠加后的真实值：按钮原来的 opacity-60 会把星星压到 2.37:1（亮）/ 3.36:1（暗），
                    // 所以那层不透明度去掉了，现在是 5.00:1（亮）/ 6.80:1（暗）。
                    rating && 'text-chart-4 fill-chart-4',
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('task.rate')}</TooltipContent>
          </Tooltip>

          {/* 分享按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleShareClick}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={t('task.share')}
              >
                <Share2 className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('task.share')}</TooltipContent>
          </Tooltip>

          {/* 删除按钮 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                aria-label={t('task.delete')}
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('task.delete')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  )
}

export default TaskCard
