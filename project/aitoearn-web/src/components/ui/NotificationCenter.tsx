/**
 * NotificationCenter - 全局通知中心组件
 * 显示不同类型的通知（success/error/warning/info/loading）
 * 支持鼠标悬停暂停自动关闭、手动关闭等功能
 */
'use client'

import { AlertCircle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { cn } from '@/utils/className'

type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading'

interface NotificationDetail {
  key?: string
  id?: string
  _uid?: string
  content?: React.ReactNode
  duration?: number
  type?: NotificationType
}

interface NotificationItem {
  uid: string
  key?: string
  content: React.ReactNode
  duration: number
  expiresAt: number
  visible: boolean
  type: NotificationType
  isPaused: boolean
}

function genUid() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

// 通知图标配置
// 五种提示统一走 bg-card/95 这一层不透明底 + 语义色边框/图标/进度条，
// 颜色信息靠边框、图标、进度条带，不靠底色染。
// 原来写死的 *-50/95 底色在亮色下把图标压死了：warning 图标 2.84:1、success 图标 3.15:1，图标门槛 3:1。
// 换成主题变量后压在 bg-card/95 上：success 6.34、warning 5.75、error 5.55、info 6.69（亮），
// 暗色 9.22 / 7.99 / 6.45 / 6.72，正文 text-foreground 17.45（亮）/ 14.73（暗）。
// 注意不能直接把底色换成 bg-success/10 这类半透明：通知浮在页面内容之上，
// 底色透到 10% 会让正文压在任意内容上，可读性反而更差。
const notificationConfig: Record<
  NotificationType,
  {
    icon: React.ReactNode
    containerClass: string
    iconClass: string
  }
> = {
  success: {
    icon: <CheckCircle2 className="w-5 h-5" />,
    containerClass: 'border-success/30 bg-card/95',
    iconClass: 'text-success-text',
  },
  error: {
    icon: <XCircle className="w-5 h-5" />,
    containerClass: 'border-destructive/30 bg-card/95',
    iconClass: 'text-destructive',
  },
  warning: {
    icon: <AlertCircle className="w-5 h-5" />,
    containerClass: 'border-warning/30 bg-card/95',
    iconClass: 'text-warning-text',
  },
  info: {
    icon: <Info className="w-5 h-5" />,
    containerClass: 'border-info/30 bg-card/95',
    iconClass: 'text-info',
  },
  loading: {
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
    containerClass: 'border-border bg-card/95',
    iconClass: 'text-primary',
  },
}

export const NotificationCenter: React.FC = () => {
  const [items, setItems] = useState<NotificationItem[]>([])
  const timeoutsRef = useRef<Record<string, number>>({})
  const remainingRef = useRef<Record<string, number>>({})
  const animationStartRef = useRef<Record<string, number>>({})

  useEffect(() => {
    function onAdd(e: Event) {
      const detail = (e as CustomEvent)?.detail as NotificationDetail | undefined
      if (!detail)
        return
      const uid = detail._uid || genUid()
      const key = detail.key || detail.id
      const type = detail.type || 'info'
      // loading 类型默认不自动关闭，其他类型默认 3 秒
      const defaultDuration = type === 'loading' ? 0 : 3000
      const duration
        = typeof detail.duration === 'number' ? detail.duration * 1000 : defaultDuration
      const expiresAt = duration > 0 ? Date.now() + duration : 0
      const item: NotificationItem = {
        uid,
        key,
        content: detail.content || '',
        duration,
        expiresAt,
        visible: false,
        type,
        isPaused: false,
      }

      // 相同 key 去重：如果已有同 key 的通知，替换内容并重置计时器，不再新增
      if (key) {
        setItems((prev) => {
          const existingIndex = prev.findIndex(it => it.key === key)
          if (existingIndex !== -1) {
            const existing = prev[existingIndex]
            // 清除旧的定时器
            if (timeoutsRef.current[existing.uid]) {
              clearTimeout(timeoutsRef.current[existing.uid])
              delete timeoutsRef.current[existing.uid]
            }
            delete remainingRef.current[existing.uid]
            delete animationStartRef.current[existing.uid]

            // 用新 uid 替换旧通知，保持位置不变
            const updated = [...prev]
            updated[existingIndex] = { ...item, visible: true }
            return updated
          }
          return [item, ...prev]
        })
      }
      else {
        // 无 key 的通知正常添加到顶部
        setItems(prev => [item, ...prev])
      }

      // 触发入场动画（仅对新增的通知）
      setTimeout(() => {
        setItems(prev => prev.map(it => (it.uid === uid ? { ...it, visible: true } : it)))
      }, 10)

      // 自动关闭（duration > 0，带 key 的通知也需要自动关闭）
      if (duration > 0) {
        // 记录动画开始时间
        animationStartRef.current[uid] = Date.now()
        remainingRef.current[uid] = duration

        const timeoutId = window.setTimeout(() => {
          // 开始退出动画
          setItems(prev => prev.map(it => (it.uid === uid ? { ...it, visible: false } : it)))
          // 动画结束后移除
          const removeId = window.setTimeout(() => {
            setItems(prev => prev.filter(it => it.uid !== uid))
            delete timeoutsRef.current[uid]
            delete remainingRef.current[uid]
            delete animationStartRef.current[uid]
          }, 300)
          timeoutsRef.current[uid] = removeId
        }, duration)
        timeoutsRef.current[uid] = timeoutId
      }
    }

    function onRemove(e: Event) {
      const detail = (e as CustomEvent)?.detail as NotificationDetail | undefined
      if (!detail)
        return
      const uid = detail._uid
      const key = detail.key || detail.id
      if (uid) {
        if (timeoutsRef.current[uid]) {
          clearTimeout(timeoutsRef.current[uid])
          delete timeoutsRef.current[uid]
        }
        setItems(prev => prev.map(it => (it.uid === uid ? { ...it, visible: false } : it)))
        setTimeout(() => {
          setItems(prev => prev.filter(it => it.uid !== uid))
          delete remainingRef.current[uid]
          delete animationStartRef.current[uid]
        }, 300)
      }
      if (key) {
        setItems(prev => prev.map(it => (it.key === key ? { ...it, visible: false } : it)))
        setTimeout(() => {
          setItems(prev => prev.filter((it) => {
            if (it.key === key) {
              if (timeoutsRef.current[it.uid]) {
                clearTimeout(timeoutsRef.current[it.uid])
                delete timeoutsRef.current[it.uid]
              }
              delete remainingRef.current[it.uid]
              delete animationStartRef.current[it.uid]
              return false
            }
            return true
          }))
        }, 300)
      }
    }

    window.addEventListener('aito:notification', onAdd as EventListener)
    window.addEventListener('aito:notification-remove', onRemove as EventListener)
    return () => {
      window.removeEventListener('aito:notification', onAdd as EventListener)
      window.removeEventListener('aito:notification-remove', onRemove as EventListener)
    }
  }, [])

  // 关闭通知
  const handleClose = (uid: string) => {
    if (timeoutsRef.current[uid]) {
      clearTimeout(timeoutsRef.current[uid])
      delete timeoutsRef.current[uid]
    }
    setItems(prev => prev.map(it => (it.uid === uid ? { ...it, visible: false } : it)))
    setTimeout(() => {
      setItems(prev => prev.filter(it => it.uid !== uid))
      delete remainingRef.current[uid]
      delete animationStartRef.current[uid]
    }, 300)
  }

  // 鼠标进入暂停自动关闭
  const handleMouseEnter = (uid: string, item: NotificationItem) => {
    // 清除当前定时器
    if (timeoutsRef.current[uid]) {
      clearTimeout(timeoutsRef.current[uid])
      delete timeoutsRef.current[uid]
    }
    // 计算剩余时间
    const startTime = animationStartRef.current[uid]
    if (startTime && item.duration > 0) {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, item.duration - elapsed)
      remainingRef.current[uid] = remaining
    }
    // 标记为暂停，触发 CSS 动画暂停
    setItems(prev => prev.map(it => (it.uid === uid ? { ...it, isPaused: true } : it)))
  }

  // 鼠标离开恢复自动关闭
  const handleMouseLeave = (uid: string, item: NotificationItem) => {
    const remaining = remainingRef.current[uid]
    // 如果没有剩余时间或 duration 为 0，不需要恢复
    if (!remaining || remaining <= 0 || item.duration <= 0) {
      setItems(prev => prev.map(it => (it.uid === uid ? { ...it, isPaused: false } : it)))
      return
    }

    // 更新动画开始时间，使进度条从暂停位置继续
    animationStartRef.current[uid] = Date.now() - (item.duration - remaining)

    // 恢复动画
    setItems(prev => prev.map(it => (it.uid === uid ? { ...it, isPaused: false } : it)))

    // 重新设置定时器
    const timeoutId = window.setTimeout(() => {
      // 开始退出动画
      setItems(prev => prev.map(it => (it.uid === uid ? { ...it, visible: false } : it)))
      // 动画结束后移除
      const removeId = window.setTimeout(() => {
        setItems(prev => prev.filter(it => it.uid !== uid))
        delete timeoutsRef.current[uid]
        delete remainingRef.current[uid]
        delete animationStartRef.current[uid]
      }, 300)
      timeoutsRef.current[uid] = removeId
    }, remaining)
    timeoutsRef.current[uid] = timeoutId
  }

  return (
    <div className="fixed top-4 right-4 z-[500000] flex flex-col items-end gap-3 pointer-events-none">
      {items.map((item) => {
        const config = notificationConfig[item.type]

        return (
          <div
            key={item.uid}
            className={cn(
              'w-[360px] max-w-[calc(100vw-2rem)] pointer-events-auto',
              'border rounded-lg shadow-lg backdrop-blur-sm',
              'transform transition-all duration-300 ease-out',
              item.visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4',
              config.containerClass,
            )}
            role="status"
            aria-live="polite"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onPointerDownCapture={(e) => {
              // 在捕获阶段阻止事件传播
              // Radix UI 的 DismissableLayer 使用 onPointerDownCapture 检测外部点击
              // 必须在捕获阶段阻止，否则冒泡阶段已经太晚
              e.stopPropagation()
            }}
            onMouseEnter={() => handleMouseEnter(item.uid, item)}
            onMouseLeave={() => handleMouseLeave(item.uid, item)}
          >
            <div className="flex items-start gap-3 p-4">
              {/* 图标 */}
              <div className={cn('flex-shrink-0 mt-0.5', config.iconClass)}>{config.icon}</div>

              {/* 内容 */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground break-words">
                  {item.content}
                </div>
              </div>

              {/* 关闭按钮 */}
              <button
                type="button"
                aria-label="Close notification"
                onClick={() => handleClose(item.uid)}
                className={cn(
                  'flex-shrink-0 p-1 rounded-md cursor-pointer',
                  // 别再往 text-muted-foreground 上叠 /60：叠加后亮色只有 2.4:1，图标门槛 3:1 不过。
                  // 不叠是 5.0~5.5:1（亮）/ 5.9~6.5:1（暗），四种底色都算过了。
                  'text-muted-foreground hover:text-foreground',
                  'hover:bg-black/5 dark:hover:bg-white/10',
                  'transition-colors duration-150',
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 进度条（可选，显示剩余时间） */}
            {item.duration > 0 && item.visible && (
              <div className="h-1 bg-black/5 dark:bg-white/5 rounded-b-lg overflow-hidden">
                <div
                  className={cn(
                    'h-full',
                    // 进度条跟着上面那套语义色走，别再留一套写死的 *-500。
                    item.type === 'success' && 'bg-success',
                    item.type === 'error' && 'bg-destructive',
                    item.type === 'warning' && 'bg-warning',
                    item.type === 'info' && 'bg-info',
                    item.type === 'loading' && 'bg-primary',
                  )}
                  style={{
                    width: '100%',
                    animation: `shrink ${item.duration}ms linear forwards`,
                    animationPlayState: item.isPaused ? 'paused' : 'running',
                  }}
                />
              </div>
            )}
          </div>
        )
      })}

      {/* 进度条动画 CSS */}
      <style jsx>
        {`
          @keyframes shrink {
            from {
              width: 100%;
            }
            to {
              width: 0%;
            }
          }
        `}
      </style>
    </div>
  )
}

export default NotificationCenter
