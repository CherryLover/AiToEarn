/**
 * useProjectChatSession - 一个项目当前聊到哪一条会话
 *
 * 规则：一个项目默认接着上一条会话往下聊，可以主动开一条新的，也可以翻历史切回去。
 *
 * 会话归属项目是服务端存的（任务上的 projectName），本地记的那条只是个偏好：
 * **必须拿服务端的列表核对一遍才能用**。本地记着、服务端已经没了的会话（被删掉、
 * 换了账号、或者本来就是别人的），直接拿去加载会弹一个「找不到」的错，
 * 而这种情况下人要的只是接着聊，不是看报错。核不上就退回最近一条。
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { agentApi } from '@/api/ai/ai.api'

/** 核对本地那条还在不在时，往回翻几条够用了 */
const RECENT_PAGE_SIZE = 20

/** 每个项目单独记一条，key 里带项目名 */
function storageKey(projectName: string): string {
  return `projects.chat.task.${projectName}`
}

/** 读不到（无痕模式、被禁用）就当没记过，回退到去服务端拉 */
function readStoredTaskId(projectName: string): string {
  if (typeof window === 'undefined')
    return ''

  try {
    return window.localStorage.getItem(storageKey(projectName)) || ''
  }
  catch {
    return ''
  }
}

/** 写不进去只是下次进来要重新拉一次，不提示、不打断 */
function writeStoredTaskId(projectName: string, taskId: string) {
  if (typeof window === 'undefined')
    return

  try {
    if (taskId)
      window.localStorage.setItem(storageKey(projectName), taskId)
    else
      window.localStorage.removeItem(storageKey(projectName))
  }
  catch {
    // 忽略：无痕模式下写入会抛异常
  }
}

export interface ProjectChatSession {
  /** 当前会话 ID；空串表示还没有会话，下一条消息会新建一个 */
  taskId: string
  /** 正在确定当前会话是哪一条 */
  isResolving: boolean
  /** 开一条新的，下一条消息才真正建任务 */
  startNew: () => void
  /** 从历史里切一条过来 */
  select: (taskId: string) => void
  /** 新建任务拿到真实 ID 后认领它 */
  adopt: (taskId: string) => void
}

export function useProjectChatSession(projectName: string): ProjectChatSession {
  const [taskId, setTaskId] = useState('')
  const [isResolving, setIsResolving] = useState(true)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!projectName) {
      setIsResolving(false)
      return
    }

    let cancelled = false
    const resolveCurrent = async () => {
      setIsResolving(true)
      try {
        const res = await agentApi.getTaskList({ projectName, page: 1, pageSize: RECENT_PAGE_SIZE })
        if (cancelled || !mountedRef.current)
          return

        const list = res?.code === 0 && Array.isArray(res.data?.list) ? res.data.list : []
        const stored = readStoredTaskId(projectName)
        // 本地记的那条服务端还在就用它，不在就退回最近一条；一条都没有就是空会话
        const next = (stored && list.some(task => task.id === stored) ? stored : list[0]?.id) || ''

        setTaskId(next)
        if (next !== stored)
          writeStoredTaskId(projectName, next)
      }
      catch (error) {
        // 拉不到就当这个项目还没聊过，从空会话开始，不用打断用户。
        // 这里不回退到本地记的那条：核不上就用，正是要避免的那个「找不到」报错。
        console.error('Resolve project chat session failed:', error)
      }
      finally {
        if (!cancelled && mountedRef.current)
          setIsResolving(false)
      }
    }

    resolveCurrent()
    return () => {
      cancelled = true
    }
  }, [projectName])

  const startNew = useCallback(() => {
    setTaskId('')
    writeStoredTaskId(projectName, '')
  }, [projectName])

  const select = useCallback((next: string) => {
    setTaskId(next)
    writeStoredTaskId(projectName, next)
  }, [projectName])

  const adopt = useCallback((next: string) => {
    if (!next)
      return

    setTaskId(next)
    writeStoredTaskId(projectName, next)
  }, [projectName])

  return { taskId, isResolving, startNew, select, adopt }
}
