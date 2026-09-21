/**
 * useProjectAgentTask - 在项目物料目录里跑一次 AI 任务
 * 阶段 2 的「让 AI 提炼方向」和「生成内容」都用它：带上 projectName 起一个 Agent 任务，
 * 把过程里的文字流出来给人看，跑完通知调用方去刷新文件。
 * 复用 api/ai 的 createTaskWithSSE，不另起一套请求封装。
 */
'use client'

import type { CreateAgentTaskParams } from '@/api/ai/ai.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { agentApi } from '@/api/ai/ai.api'
import { pickProgressText, readTerminalError } from './agent-progress'

/**
 * 带项目的 Agent 任务入参。
 * 服务端 CreateContentGenerationTaskDto 已经支持 projectName（阶段 1 加的），
 * 但 api/ai 的 CreateAgentTaskParams 还没跟上，这里补一个扩展类型，不去改别人的模块。
 */
export interface ProjectAgentTaskParams extends CreateAgentTaskParams {
  /** 项目英文名，Agent 的工作目录会锁在这个项目的物料目录里 */
  projectName: string
}

export type ProjectAgentTaskStatus = 'idle' | 'running' | 'done' | 'error'

/** 过程里最多留几行，够看清它在干什么就行 */
const MAX_LOG_LINES = 40

export function useProjectAgentTask() {
  const [status, setStatus] = useState<ProjectAgentTaskStatus>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [errorText, setErrorText] = useState('')
  const [taskId, setTaskId] = useState('')

  const mountedRef = useRef(true)
  // 回调里拿不到最新的 state，状态和 taskId 另存一份
  const statusRef = useRef<ProjectAgentTaskStatus>('idle')
  const taskIdRef = useRef('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      statusRef.current = 'idle'
    }
  }, [])

  const applyStatus = useCallback((next: ProjectAgentTaskStatus) => {
    statusRef.current = next
    if (mountedRef.current)
      setStatus(next)
  }, [])

  const appendLog = useCallback((text: string) => {
    if (!text)
      return

    setLogs(prev => [...prev, text].slice(-MAX_LOG_LINES))
  }, [])

  /**
   * 停止。
   * createTaskWithSSE 要等整条流结束才把 abort 函数交回来，跑到一半时本地没东西可中断，
   * 所以这里直接走服务端的中断接口，任务真的停，页面也立刻回到可操作状态。
   */
  const stop = useCallback(async () => {
    if (statusRef.current !== 'running')
      return

    const runningTaskId = taskIdRef.current
    applyStatus('idle')

    if (!runningTaskId)
      return

    try {
      await agentApi.abortTask(runningTaskId)
    }
    catch (error) {
      console.error('Abort project agent task failed:', error)
    }
  }, [applyStatus])

  const reset = useCallback(() => {
    applyStatus('idle')
    taskIdRef.current = ''
    if (!mountedRef.current)
      return

    setLogs([])
    setErrorText('')
    setTaskId('')
  }, [applyStatus])

  /**
   * 起一个任务。onFinished 在任务正常跑完后调用，用来刷新列表和文件。
   */
  const run = useCallback(
    async (params: ProjectAgentTaskParams, onFinished?: () => void) => {
      applyStatus('running')
      taskIdRef.current = ''
      setLogs([])
      setErrorText('')
      setTaskId('')

      await agentApi.createTaskWithSSE(
        params,
        (message) => {
          // 已经被人手动停掉或已经结束的，后面的消息一概不理
          if (statusRef.current !== 'running')
            return

          if (message.taskId && message.taskId !== taskIdRef.current) {
            taskIdRef.current = message.taskId
            setTaskId(message.taskId)
          }

          // 失败必须在这里落到 error 状态：服务端把失败发成一条普通分片，
          // 连接随后正常关闭，只看关闭事件的话页面会显示「跑完了」；
          // 而 SSE 客户端收到这条之后会直接掐断连接，onDone / onError 一个都不会再来，
          // 不在这里收口就会一直转圈，错误信息也永远显示不出来
          const failure = readTerminalError(message)
          if (failure) {
            if (mountedRef.current)
              setErrorText(failure)
            applyStatus('error')
            return
          }

          if (message.type === 'keep_alive' || message.type === 'init')
            return

          appendLog(pickProgressText(message))
        },
        (error) => {
          if (statusRef.current !== 'running')
            return

          if (mountedRef.current)
            setErrorText(error.message)
          applyStatus('error')
        },
        () => {
          if (statusRef.current !== 'running')
            return

          applyStatus('done')
          onFinished?.()
        },
      )
    },
    [appendLog, applyStatus],
  )

  return { status, logs, errorText, taskId, run, stop, reset }
}
