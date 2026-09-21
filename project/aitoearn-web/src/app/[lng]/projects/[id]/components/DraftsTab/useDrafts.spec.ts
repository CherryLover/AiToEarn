import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_FILE_ERROR_CODE } from '@/api/projects/project-file.constants'
import { ProjectFileType } from '@/api/projects/project-file.types'

const getProjectFileTreeApi = vi.fn()

vi.mock('@/api/projects/project-file.api', () => ({
  getProjectFileTreeApi: (...a: unknown[]) => getProjectFileTreeApi(...a),
}))

const { useDrafts } = await import('./useDrafts')

function draftsTree() {
  return {
    name: 'drafts',
    path: 'drafts',
    type: ProjectFileType.Dir,
    size: null,
    updatedAt: '2026-09-21T00:00:00.000Z',
    children: [{
      name: '2026-09-21-xhs-pain-point',
      path: 'drafts/2026-09-21-xhs-pain-point',
      type: ProjectFileType.Dir,
      size: null,
      updatedAt: '2026-09-21T00:00:00.000Z',
      children: [{
        name: 'content.md',
        path: 'drafts/2026-09-21-xhs-pain-point/content.md',
        type: ProjectFileType.File,
        size: 10,
        updatedAt: '2026-09-21T00:00:00.000Z',
        children: null,
      }],
    }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectFileTreeApi.mockResolvedValue({ code: 0, data: draftsTree() })
})

describe('useDrafts', () => {
  it('从 drafts 目录树里认出草稿', async () => {
    const { result } = renderHook(() => useDrafts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(getProjectFileTreeApi).toHaveBeenCalledWith('p1', { path: 'drafts', depth: expect.any(Number) })
    expect(result.current.drafts).toHaveLength(1)
    expect(result.current.drafts[0].contentPath).toBe('drafts/2026-09-21-xhs-pain-point/content.md')
    expect(result.current.loadFailed).toBe(false)
  })

  it('没有项目 id 时不发请求', async () => {
    renderHook(() => useDrafts(''))
    await act(async () => {})
    expect(getProjectFileTreeApi).not.toHaveBeenCalled()
  })

  /**
   * 还没生成过内容的项目根本没有 drafts 目录，服务端会回「不存在」。
   * 那不是错误，是空状态——报成「加载失败」会让人以为系统坏了。
   */
  it('drafts 目录不存在当空列表，不当加载失败', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.NotFound, data: null })

    const { result } = renderHook(() => useDrafts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.drafts).toEqual([])
    expect(result.current.loadFailed).toBe(false)
  })

  it('别的业务错误才算加载失败', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.PathInvalid, data: null })

    const { result } = renderHook(() => useDrafts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.loadFailed).toBe(true)
  })

  it('请求抛异常时清空并标记失败', async () => {
    getProjectFileTreeApi.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => useDrafts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.drafts).toEqual([])
    expect(result.current.loadFailed).toBe(true)
  })

  it('refresh 会重新拉一遍', async () => {
    const { result } = renderHook(() => useDrafts('p1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await result.current.refresh() })

    expect(getProjectFileTreeApi).toHaveBeenCalledTimes(2)
  })
})
