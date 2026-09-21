import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProjectAngleTotalsApi = vi.fn()
const getProjectMetricTrendsApi = vi.fn()

vi.mock('@/api/creator-notes/creator-notes.api', () => ({
  getProjectAngleTotalsApi: (...args: unknown[]) => getProjectAngleTotalsApi(...args),
  getProjectMetricTrendsApi: (...args: unknown[]) => getProjectMetricTrendsApi(...args),
}))

const { useProjectMetrics } = await import('./useProjectMetrics')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectAngleTotalsApi.mockResolvedValue({ code: 0, data: [] })
  getProjectMetricTrendsApi.mockResolvedValue({ code: 0, data: [] })
})

describe('useProjectMetrics', () => {
  it('趋势和方向汇总一起拉，天数原样传给服务端', async () => {
    getProjectMetricTrendsApi.mockResolvedValue({ code: 0, data: [{ publishedPostId: 'post-1' }] })
    getProjectAngleTotalsApi.mockResolvedValue({ code: 0, data: [{ angleId: 'a1' }] })

    const { result } = renderHook(() => useProjectMetrics('p1', 7))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(getProjectMetricTrendsApi).toHaveBeenCalledWith('p1', { days: 7 })
    expect(getProjectAngleTotalsApi).toHaveBeenCalledWith('p1', { days: 7 })
    expect(result.current.trends).toHaveLength(1)
    expect(result.current.angleTotals).toHaveLength(1)
    expect(result.current.loadFailed).toBe(false)
  })

  /** 项目 id 还没拿到时别打请求，否则会打出一个 `projects//trends` 这种地址 */
  it('没有项目 id 时不发请求', async () => {
    renderHook(() => useProjectMetrics('', 7))

    await act(async () => {})
    expect(getProjectMetricTrendsApi).not.toHaveBeenCalled()
    expect(getProjectAngleTotalsApi).not.toHaveBeenCalled()
  })

  it('任一边返回业务错误就标记加载失败', async () => {
    getProjectAngleTotalsApi.mockResolvedValue({ code: 20705, data: null })

    const { result } = renderHook(() => useProjectMetrics('p1', 7))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.loadFailed).toBe(true)
    expect(result.current.angleTotals).toEqual([])
  })

  it('请求抛异常时清空并标记失败', async () => {
    getProjectMetricTrendsApi.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => useProjectMetrics('p1', 7))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.trends).toEqual([])
    expect(result.current.angleTotals).toEqual([])
    expect(result.current.loadFailed).toBe(true)
  })

  it('返回的不是数组时当空处理', async () => {
    getProjectMetricTrendsApi.mockResolvedValue({ code: 0, data: null })

    const { result } = renderHook(() => useProjectMetrics('p1', 7))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.trends).toEqual([])
  })

  /** 切换天数是这一块唯一的交互，不重拉就等于切了个寂寞 */
  it('天数变了会重新拉一遍', async () => {
    const { rerender } = renderHook(({ days }) => useProjectMetrics('p1', days), {
      initialProps: { days: 7 },
    })
    await waitFor(() => expect(getProjectMetricTrendsApi).toHaveBeenCalledTimes(1))

    rerender({ days: 30 })

    await waitFor(() => expect(getProjectMetricTrendsApi).toHaveBeenCalledTimes(2))
    expect(getProjectMetricTrendsApi).toHaveBeenLastCalledWith('p1', { days: 30 })
  })

  it('卸载之后回来的响应不会再写状态', async () => {
    let resolveTrends: ((value: unknown) => void) | undefined
    getProjectMetricTrendsApi.mockImplementation(() => new Promise((resolve) => { resolveTrends = resolve }))

    const { unmount } = renderHook(() => useProjectMetrics('p1', 7))
    unmount()

    await act(async () => {
      resolveTrends?.({ code: 0, data: [{ publishedPostId: 'post-1' }] })
    })

    expect(getProjectMetricTrendsApi).toHaveBeenCalled()
  })
})
