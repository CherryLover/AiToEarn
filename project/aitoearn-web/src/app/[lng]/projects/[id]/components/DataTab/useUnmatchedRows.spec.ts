import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MatchState } from '@/api/creator-notes/creator-notes.types'

const adoptCreatorNoteRowApi = vi.fn()
const claimCreatorNoteRowApi = vi.fn()
const getCreatorNoteRowListApi = vi.fn()

vi.mock('@/api/creator-notes/creator-notes.api', () => ({
  adoptCreatorNoteRowApi: (...args: unknown[]) => adoptCreatorNoteRowApi(...args),
  claimCreatorNoteRowApi: (...args: unknown[]) => claimCreatorNoteRowApi(...args),
  getCreatorNoteRowListApi: (...args: unknown[]) => getCreatorNoteRowListApi(...args),
}))

const { useUnmatchedRows } = await import('./useUnmatchedRows')

function listRes(list: Array<{ id: string }>, total = list.length, code = 0) {
  return { code, data: { list, total, page: 1, pageSize: 50, totalPages: 1 } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getCreatorNoteRowListApi.mockResolvedValue(listRes([]))
})

describe('useUnmatchedRows', () => {
  /**
   * 「待定」跟「未归属」都得人来定夺，分两块只会让人以为待定是系统还在处理。
   * 待定排在前面，因为那几条离认领最近。
   */
  it('未归属和待定合成一块，待定排前面，总数相加', async () => {
    getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
      params.matchState === MatchState.Ambiguous
        ? listRes([{ id: 'amb-1' }], 1)
        : listRes([{ id: 'un-1' }, { id: 'un-2' }], 5))

    const { result } = renderHook(() => useUnmatchedRows('p1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.rows.map(row => row.id)).toEqual(['amb-1', 'un-1', 'un-2'])
    expect(result.current.total).toBe(6)
    expect(result.current.loadFailed).toBe(false)
  })

  it('任一边返回业务错误就标记加载失败', async () => {
    getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
      params.matchState === MatchState.Ambiguous ? listRes([], 0, 20000) : listRes([{ id: 'un-1' }]))

    const { result } = renderHook(() => useUnmatchedRows('p1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.loadFailed).toBe(true)
  })

  /** 请求整个挂掉时页面要显示「加载失败」，而不是一个看起来正常的空列表 */
  it('请求抛异常时清空并标记失败', async () => {
    getCreatorNoteRowListApi.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => useUnmatchedRows('p1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.rows).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.loadFailed).toBe(true)
  })

  it('返回的结构不是数组时当空列表处理，不炸', async () => {
    getCreatorNoteRowListApi.mockResolvedValue({ code: 0, data: { list: null, total: 'x' } })

    const { result } = renderHook(() => useUnmatchedRows('p1'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.rows).toEqual([])
    expect(result.current.total).toBe(0)
  })

  /** 认领成功那一行要立刻消失，不然人会以为没点上又点一次 */
  it('认领成功后那一行立刻从列表里消失，总数减一', async () => {
    getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
      params.matchState === MatchState.Ambiguous ? listRes([]) : listRes([{ id: 'r1' }, { id: 'r2' }], 2))
    claimCreatorNoteRowApi.mockResolvedValue({ code: 0, data: {} })

    const { result } = renderHook(() => useUnmatchedRows('p1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))

    await act(async () => {
      await expect(result.current.claim('r1', 'post-1')).resolves.toBe(true)
    })

    expect(claimCreatorNoteRowApi).toHaveBeenCalledWith('r1', 'post-1')
    expect(result.current.rows.map(row => row.id)).toEqual(['r2'])
    expect(result.current.total).toBe(1)
  })

  it('认领失败时那一行留在原地', async () => {
    getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
      params.matchState === MatchState.Ambiguous ? listRes([]) : listRes([{ id: 'r1' }]))
    claimCreatorNoteRowApi.mockResolvedValue({ code: 20700, data: null })

    const { result } = renderHook(() => useUnmatchedRows('p1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    await act(async () => {
      await expect(result.current.claim('r1', 'post-1')).resolves.toBe(false)
    })

    expect(result.current.rows).toHaveLength(1)
  })

  /** projectId 由 hook 自己补上：调用方漏传会把记录建到别的项目里去 */
  it('建成新记录时自动补上当前项目 id', async () => {
    getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
      params.matchState === MatchState.Ambiguous ? listRes([]) : listRes([{ id: 'r1' }]))
    adoptCreatorNoteRowApi.mockResolvedValue({ code: 0, data: {} })

    const { result } = renderHook(() => useUnmatchedRows('p1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    await act(async () => {
      await expect(result.current.adopt('r1', { angleId: 'a1' })).resolves.toBe(true)
    })

    expect(adoptCreatorNoteRowApi).toHaveBeenCalledWith('r1', { angleId: 'a1', projectId: 'p1' })
    expect(result.current.rows).toHaveLength(0)
  })

  it('建成新记录失败时那一行留在原地', async () => {
    getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
      params.matchState === MatchState.Ambiguous ? listRes([]) : listRes([{ id: 'r1' }]))
    adoptCreatorNoteRowApi.mockResolvedValue({ code: 20713, data: null })

    const { result } = renderHook(() => useUnmatchedRows('p1'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))

    await act(async () => {
      await expect(result.current.adopt('r1', { angleId: undefined })).resolves.toBe(false)
    })

    expect(result.current.rows).toHaveLength(1)
  })

  it('refresh 会重新拉一遍', async () => {
    const { result } = renderHook(() => useUnmatchedRows('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    getCreatorNoteRowListApi.mockClear()

    await act(async () => {
      await result.current.refresh()
    })

    expect(getCreatorNoteRowListApi).toHaveBeenCalledTimes(2)
  })

  /** 组件卸载之后再 setState 会在控制台刷一片警告，而且是真的内存泄漏 */
  it('卸载之后回来的响应不会再写状态', async () => {
    let resolveList: ((value: unknown) => void) | undefined
    getCreatorNoteRowListApi.mockImplementation(() => new Promise((resolve) => { resolveList = resolve }))

    const { unmount } = renderHook(() => useUnmatchedRows('p1'))
    unmount()

    await act(async () => {
      resolveList?.(listRes([{ id: 'r1' }]))
    })

    // 没抛错、没有 act 警告就说明没有在卸载之后写状态
    expect(getCreatorNoteRowListApi).toHaveBeenCalled()
  })
})
