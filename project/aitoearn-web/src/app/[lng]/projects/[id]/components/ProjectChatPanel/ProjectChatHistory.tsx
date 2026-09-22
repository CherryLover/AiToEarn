/**
 * ProjectChatHistory - 这个项目下的历史会话
 * 只列当前项目的（服务端按 projectName 筛），点一条切过去。
 */
'use client'

import type { TaskListItem } from '@/api/ai/ai.types'
import { Check, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { agentApi } from '@/api/ai/ai.api'
import { useTransClient } from '@/app/i18n/client'
import { cn } from '@/utils/className'

/** 面板里放不下太多，够翻回最近几次就行 */
const PAGE_SIZE = 20

interface ProjectChatHistoryProps {
  projectName: string
  /** 当前正在聊的那条，列表里标出来 */
  currentTaskId: string
  /** 每次打开都重新拉，靠这个值变化触发 */
  reloadToken: number
  onSelect: (taskId: string) => void
}

export function ProjectChatHistory(props: ProjectChatHistoryProps) {
  const { projectName, currentTaskId, reloadToken, onSelect } = props
  const { t } = useTransClient('projects')

  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await agentApi.getTaskList({ projectName, page: 1, pageSize: PAGE_SIZE })
      if (res?.code === 0 && Array.isArray(res.data?.list)) {
        setTasks(res.data.list)
        setLoadFailed(false)
      }
      else {
        setTasks([])
        setLoadFailed(true)
      }
    }
    catch (error) {
      console.error('Load project chat history failed:', error)
      setTasks([])
      setLoadFailed(true)
    }
    finally {
      setIsLoading(false)
    }
  }, [projectName])

  useEffect(() => {
    load()
  }, [load, reloadToken])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t('chat.history.loading')}
      </div>
    )
  }

  if (loadFailed) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        {t('chat.history.loadFailed')}
      </p>
    )
  }

  if (tasks.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        {t('chat.history.empty')}
      </p>
    )
  }

  return (
    <ul className="max-h-72 overflow-y-auto py-1">
      {tasks.map((task) => {
        const isCurrent = task.id === currentTaskId
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onSelect(task.id)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted',
                isCurrent && 'bg-muted',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">
                {task.title?.trim() || t('chat.history.untitled')}
              </span>
              {isCurrent && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
