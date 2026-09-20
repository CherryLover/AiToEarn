/**
 * ChatHeader - 对话页面顶部导航栏
 * 显示返回按钮、标题、生成状态
 */
'use client'

import { ArrowLeft, Bot, Heart, Loader2, Pencil, Share2, Star, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import RatingModal from '@/components/Chat/Rating'
import ShareModal from '@/components/Chat/Share/ShareModal'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/className'
import styles from '../../../layout.module.css'

const STORAGE_KEY = 'chat-announcement-dismissed'

/** PC 端公告提示 */
function DesktopAnnouncementTip() {
  const { t } = useTransClient('home')
  const text = t('announcement.text')
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [needsScroll, setNeedsScroll] = useState(false)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(STORAGE_KEY) === 'true')
    }
    catch {
      setDismissed(false)
    }
  }, [])

  useEffect(() => {
    if (dismissed)
      return

    const checkScroll = () => {
      if (containerRef.current && textRef.current) {
        setNeedsScroll(textRef.current.scrollWidth > containerRef.current.offsetWidth)
      }
    }

    checkScroll()
    window.addEventListener('resize', checkScroll)
    return () => window.removeEventListener('resize', checkScroll)
  }, [text, dismissed])

  const handleDismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(STORAGE_KEY, 'true')
    }
    catch {
      // ignore
    }
  }

  if (dismissed)
    return null

  return (
    <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 max-w-md">
      <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div ref={containerRef} className="flex-1 overflow-hidden flex items-center">
        {needsScroll ? (
          <div className={styles.marquee}>
            <span ref={textRef} className="text-xs text-muted-foreground whitespace-nowrap pr-6">
              {text}
            </span>
            <span className="text-xs text-muted-foreground whitespace-nowrap pr-6">{text}</span>
          </div>
        ) : (
          <span ref={textRef} className="text-xs text-muted-foreground whitespace-nowrap">
            {text}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
        aria-label="关闭"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

export interface IChatHeaderProps {
  /** 任务标题 */
  title?: string
  /** 默认标题（任务标题为空时显示） */
  defaultTitle: string
  /** 是否正在生成 */
  isGenerating: boolean
  /** 生成进度（0-100） */
  progress: number
  /** 思考中文案 */
  thinkingText: string
  /** 任务ID（用于评分） */
  taskId?: string
  /** 任务评分（用于显示实星） */
  rating?: number | null
  /** 是否已收藏 */
  isFavorited?: boolean
  /** 收藏加载中 */
  isFavoriteLoading?: boolean
  /** 收藏切换回调 */
  onFavoriteToggle?: () => void | Promise<void>
  /** 编辑标题回调 */
  onEditTitle?: () => void
  /** 返回按钮点击 */
  onBack: () => void
}

export function ChatHeader({
  title,
  defaultTitle,
  isGenerating,
  progress,
  thinkingText,
  onBack,
  taskId,
  rating,
  isFavorited = false,
  isFavoriteLoading = false,
  onFavoriteToggle,
  onEditTitle,
}: IChatHeaderProps) {
  const { t } = useTransClient('chat')
  const [ratingOpen, setRatingOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  return (
    <header className="flex items-center gap-3 px-4 py-3 shrink-0" id="chatHeader">
      {/* 返回按钮 */}
      <Button variant="ghost" size="icon" onClick={onBack} className="w-8 h-8">
        <ArrowLeft className="w-5 h-5" />
      </Button>

      {/* 标题 + 编辑 icon */}
      <button
        onClick={onEditTitle}
        className="flex items-center gap-1.5 group cursor-pointer hover:opacity-80 transition-opacity"
        aria-label={t('task.editTitle')}
      >
        <h1 className="text-base font-medium text-foreground line-clamp-1">
          {title || defaultTitle}
        </h1>
        {/* 不要再挂 opacity-60：叠加后只有 2.41:1（亮），图标门槛 3:1 不过。
            现在静止 5.25:1（亮）/ 6.93:1（暗）；父级 hover:opacity-80 时是 3.48:1 / 4.90:1，仍然过线。 */}
        <Pencil className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {/* PC 端公告提示 */}
      <DesktopAnnouncementTip />

      {/* 右侧区域：生成状态 + 收藏 + 分享 + 评分 */}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-2.5">
          {/* 收藏按钮 */}
          <Button
            variant="ghost"
            onClick={onFavoriteToggle}
            disabled={isFavoriteLoading}
            className="ml-1 text-sm text-muted-foreground flex items-center gap-1 h-8 px-2 cursor-pointer"
            aria-label={isFavorited ? t('task.unfavorite') : t('task.favorite')}
          >
            {isFavoriteLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Heart
                className={cn(
                  'w-5 h-5 transition-colors',
                  // 跟 TaskCard 的红心一套：写死 red-500 亮色下只有 3.60:1，
                  // 换主题变量后 5.32:1（亮）/ 7.02:1（暗）。
                  isFavorited && 'text-destructive fill-destructive',
                )}
              />
            )}
            <span>{isFavorited ? t('task.unfavorite') : t('task.favorite')}</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShareOpen(true)}
            className="ml-1 text-sm text-muted-foreground flex items-center gap-1 h-8 px-2 cursor-pointer"
          >
            <Share2 className="w-5 h-5" />
            <span>{t('task.share')}</span>
          </Button>
          {/* 文本提示，移动端隐藏以节省空间 */}
          <Button
            variant="ghost"
            onClick={() => setRatingOpen(true)}
            className="ml-1 text-sm text-muted-foreground flex items-center gap-1 h-8 px-2 cursor-pointer"
            aria-label={t('task.rate')}
          >
            {/* 跟 star-rating.tsx 一套：写死 amber-400 压在页面上只有 1.60:1，图标门槛 3:1。
                换 chart-4 后 4.78:1（亮）/ 7.44:1（暗）。 */}
            <Star
              className={`w-5 h-5 ${rating ? 'text-chart-4' : 'text-muted-foreground'}`}
              {...(rating ? { fill: 'currentColor' } : {})}
            />
            <span>{t('task.rate') || '评分'}</span>
          </Button>
        </div>
      </div>
      <ShareModal taskId={taskId ?? ''} open={shareOpen} onOpenChange={v => setShareOpen(v)} />
      <RatingModal
        taskId={taskId ?? ''}
        open={ratingOpen}
        onClose={() => setRatingOpen(false)}
        onSaved={() => {
          setRatingOpen(false)
        }}
      />
    </header>
  )
}
