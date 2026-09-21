import type { ProjectAgentTaskParams } from './useProjectAgentTask'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type OnMessage = (message: unknown) => void
type OnError = (error: Error) => void
type OnDone = () => void

const abortTask = vi.fn()
const createTaskWithSSE = vi.fn()

vi.mock('@/api/ai/ai.api', () => ({
  agentApi: {
    abortTask: (...args: unknown[]) => abortTask(...args),
    createTaskWithSSE: (...args: unknown[]) => createTaskWithSSE(...args),
  },
}))

const { useProjectAgentTask } = await import('./useProjectAgentTask')

const PARAMS = { projectName: 'forty-weeks', prompt: '提炼方向' } as unknown as ProjectAgentTaskParams

/** 把 SSE 的三个回调抓在手里，测试里自己决定什么时候发什么 */
function captureSse() {
  let onMessage: OnMessage = () => {}
  let onError: OnError = () => {}
  let onDone: OnDone = () => {}

  createTaskWithSSE.mockImplementation(async (_params, message: OnMessage, error: OnError, done: OnDone) => {
    onMessage = message
    onError = error
    onDone = done
  })

  return {
    message: (value: unknown) => onMessage(value),
    error: (value: Error) => onError(value),
    done: () => onDone(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useProjectAgentTask', () => {
  it('起任务后进 running，助手消息一行行流进日志', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())

    await act(async () => {
      await result.current.run(PARAMS)
    })
    expect(result.current.status).toBe('running')

    act(() => {
      sse.message({ message: { type: 'assistant', message: { content: [{ type: 'text', text: '正在读取素材' }] } } })
    })

    expect(result.current.logs).toEqual(['正在读取素材'])
  })

  it('心跳和初始化分片不进日志', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => {
      sse.message({ type: 'keep_alive' })
      sse.message({ type: 'init' })
    })

    expect(result.current.logs).toEqual([])
    expect(result.current.status).toBe('running')
  })

  /**
   * 2026-09-21 那个「一直转圈、没有任何进度和报错」的回归就死在这里：
   * 服务端把失败发成一条普通分片，SSE 客户端收到之后直接掐断连接，
   * onDone / onError 一个都不会再来。不在消息回调里收口，页面就永远转下去。
   */
  it('失败分片当场落到 error，不等连接关闭', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => {
      sse.message({ message: { type: 'result', subtype: 'error_max_turns', errors: ['轮数用光了'] } })
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorText).toBe('轮数用光了')
  })

  it('error 类型的分片同样落到 error', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => { sse.message({ type: 'error', message: '模型返回 500' }) })

    expect(result.current.status).toBe('error')
    expect(result.current.errorText).toBe('模型返回 500')
  })

  it('落到 error 之后，后面的分片一概不理', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => {
      sse.message({ type: 'error', message: '失败了' })
      sse.message({ message: { type: 'assistant', message: { content: [{ type: 'text', text: '不该出现' }] } } })
      sse.done()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.logs).toEqual([])
  })

  it('正常跑完进 done 并回调通知刷新', async () => {
    const sse = captureSse()
    const onFinished = vi.fn()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS, onFinished) })

    act(() => { sse.done() })

    expect(result.current.status).toBe('done')
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('连接层报错也落到 error', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => { sse.error(new Error('连接断了')) })

    expect(result.current.status).toBe('error')
    expect(result.current.errorText).toBe('连接断了')
  })

  it('记下服务端给的 taskId', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => { sse.message({ taskId: 'task-1', type: 'init' }) })

    expect(result.current.taskId).toBe('task-1')
  })

  /**
   * 停止走的是服务端中断接口，不是本地 abort：
   * createTaskWithSSE 要等整条流结束才把 abort 函数交回来，跑到一半时本地没东西可中断。
   */
  it('停止会调服务端的中断接口，并立刻回到可操作状态', async () => {
    const sse = captureSse()
    abortTask.mockResolvedValue({ code: 0 })
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })
    act(() => { sse.message({ taskId: 'task-1', type: 'init' }) })

    await act(async () => { await result.current.stop() })

    expect(result.current.status).toBe('idle')
    expect(abortTask).toHaveBeenCalledWith('task-1')
  })

  it('中断接口报错也不影响页面回到可操作状态', async () => {
    const sse = captureSse()
    abortTask.mockRejectedValue(new Error('中断失败'))
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })
    act(() => { sse.message({ taskId: 'task-1', type: 'init' }) })

    await act(async () => { await result.current.stop() })

    expect(result.current.status).toBe('idle')
  })

  it('还没拿到 taskId 就停止，只回到 idle，不空打接口', async () => {
    captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    await act(async () => { await result.current.stop() })

    expect(result.current.status).toBe('idle')
    expect(abortTask).not.toHaveBeenCalled()
  })

  it('没在跑的时候停止是空操作', async () => {
    const { result } = renderHook(() => useProjectAgentTask())

    await act(async () => { await result.current.stop() })

    expect(abortTask).not.toHaveBeenCalled()
  })

  /** 停掉之后流里还会飘几条消息回来，不能让它们把状态又改回去 */
  it('停止之后回来的分片不再改状态', async () => {
    const sse = captureSse()
    abortTask.mockResolvedValue({ code: 0 })
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })
    act(() => { sse.message({ taskId: 'task-1', type: 'init' }) })
    await act(async () => { await result.current.stop() })

    act(() => {
      sse.message({ message: { type: 'assistant', message: { content: [{ type: 'text', text: '迟到的一行' }] } } })
      sse.done()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.logs).toEqual([])
  })

  it('reset 清掉日志、错误和 taskId', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })
    act(() => {
      sse.message({ taskId: 'task-1', type: 'init' })
      sse.message({ type: 'error', message: '失败了' })
    })

    act(() => { result.current.reset() })

    expect(result.current.status).toBe('idle')
    expect(result.current.logs).toEqual([])
    expect(result.current.errorText).toBe('')
    expect(result.current.taskId).toBe('')
  })

  /** 日志只留最后几十行，跑久了不能把内存和页面撑爆 */
  it('日志只保留最后 40 行', async () => {
    const sse = captureSse()
    const { result } = renderHook(() => useProjectAgentTask())
    await act(async () => { await result.current.run(PARAMS) })

    act(() => {
      for (let i = 0; i < 50; i++)
        sse.message({ message: { type: 'assistant', message: { content: [{ type: 'text', text: `第 ${i} 行` }] } } })
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(40))
    expect(result.current.logs[0]).toBe('第 10 行')
    expect(result.current.logs.at(-1)).toBe('第 49 行')
  })
})
