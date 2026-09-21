import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPublishedPostListApi = vi.fn()

vi.mock('@/api/publishing/publishing.api', () => ({
  getPublishedPostListApi: (...a: unknown[]) => getPublishedPostListApi(...a),
}))

const { usePublishedPosts } = await import('./usePublishedPosts')

function page(list: Array<{ id: string }>, total: number, totalPages: number) {
  return { code: 0, data: { list, total, totalPages, page: 1, pageSize: 20 } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getPublishedPostListApi.mockResolvedValue(page([], 0, 1))
})

describe('usePublishedPosts', () => {
  it('首屏拉第一页', async () => {
    getPublishedPostListApi.mockResolvedValue(page([{ id: 'r1' }], 1, 1))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(getPublishedPostListApi).toHaveBeenCalledWith('p1', { page: 1, pageSize: expect.any(Number) })
    expect(result.current.posts).toHaveLength(1)
    expect(result.current.total).toBe(1)
    expect(result.current.hasMore).toBe(false)
  })

  it('没有项目 id 时不发请求', async () => {
    renderHook(() => usePublishedPosts(''))
    await act(async () => {})
    expect(getPublishedPostListApi).not.toHaveBeenCalled()
  })

  it('还有下一页时 hasMore 为真', async () => {
    getPublishedPostListApi.mockResolvedValue(page([{ id: 'r1' }], 40, 2))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.hasMore).toBe(true)
  })

  it('翻页把下一页接在后面', async () => {
    getPublishedPostListApi.mockImplementation(async (_id: string, params: { page: number }) =>
      params.page === 1 ? page([{ id: 'r1' }], 2, 2) : page([{ id: 'r2' }], 2, 2))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.loadMore() })

    expect(result.current.posts.map(post => post.id)).toEqual(['r1', 'r2'])
    expect(result.current.hasMore).toBe(false)
  })

  /** 翻页期间有人新建了记录，第二页会把第一页那条又带回来，不去重列表里就会出现两条一样的 */
  it('翻页时按 id 去重', async () => {
    getPublishedPostListApi.mockImplementation(async (_id: string, params: { page: number }) =>
      params.page === 1 ? page([{ id: 'r1' }], 3, 2) : page([{ id: 'r1' }, { id: 'r2' }], 3, 2))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.loadMore() })

    expect(result.current.posts.map(post => post.id)).toEqual(['r1', 'r2'])
  })

  it('已经到最后一页时翻页是空操作', async () => {
    getPublishedPostListApi.mockResolvedValue(page([{ id: 'r1' }], 1, 1))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    getPublishedPostListApi.mockClear()

    await act(async () => { await result.current.loadMore() })

    expect(getPublishedPostListApi).not.toHaveBeenCalled()
  })

  it('翻页失败不会把已经拿到的记录清掉', async () => {
    getPublishedPostListApi.mockImplementation(async (_id: string, params: { page: number }) => {
      if (params.page === 1)
        return page([{ id: 'r1' }], 2, 2)
      throw new Error('network')
    })

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.loadMore() })

    expect(result.current.posts.map(post => post.id)).toEqual(['r1'])
    expect(result.current.isLoadingMore).toBe(false)
  })

  it('业务错误时标记加载失败', async () => {
    getPublishedPostListApi.mockResolvedValue({ code: 20500, data: null })

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.loadFailed).toBe(true)
    expect(result.current.posts).toEqual([])
  })

  it('请求抛异常时清空并标记失败', async () => {
    getPublishedPostListApi.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.loadFailed).toBe(true)
  })

  /** 回填链接之后页面会 refresh，必须回到第一页，不然新记录看不见 */
  it('refresh 回到第一页', async () => {
    getPublishedPostListApi.mockImplementation(async (_id: string, params: { page: number }) =>
      params.page === 1 ? page([{ id: 'r1' }], 2, 2) : page([{ id: 'r2' }], 2, 2))

    const { result } = renderHook(() => usePublishedPosts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.loadMore() })

    await act(async () => { await result.current.refresh() })

    expect(result.current.posts.map(post => post.id)).toEqual(['r1'])
    expect(result.current.hasMore).toBe(true)
  })
})
