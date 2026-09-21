import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFileType } from '@/api/projects/project-file.types'

const downloadProjectFileApi = vi.fn()
const getProjectFileTreeApi = vi.fn()
const readProjectFileApi = vi.fn()

vi.mock('@/api/projects/project-file.api', () => ({
  downloadProjectFileApi: (...a: unknown[]) => downloadProjectFileApi(...a),
  getProjectFileTreeApi: (...a: unknown[]) => getProjectFileTreeApi(...a),
  readProjectFileApi: (...a: unknown[]) => readProjectFileApi(...a),
}))

const { useProjectMedia } = await import('./useProjectMedia')

function tree(names: string[]) {
  return {
    code: 0,
    data: {
      name: 'media',
      path: 'media',
      type: ProjectFileType.Dir,
      size: null,
      updatedAt: '',
      children: names.map(name => ({
        name,
        path: `media/${name}`,
        type: ProjectFileType.File,
        size: 1,
        updatedAt: '',
        children: null,
      })),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:local'),
    revokeObjectURL: vi.fn(),
  }))
  getProjectFileTreeApi.mockResolvedValue(tree([]))
})

describe('useProjectMedia 列图', () => {
  it('列出 media/ 下的图片，名片和占位文件不算', async () => {
    getProjectFileTreeApi.mockResolvedValue(tree(['a.png', 'a.png.md', '.gitkeep']))

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => { await result.current.load() })

    expect(result.current.files.map(file => file.name)).toEqual(['a.png'])
    expect(result.current.loadFailed).toBe(false)
    expect(result.current.truncated).toBe(false)
  })

  it('没有项目 id 时不发请求', async () => {
    const { result } = renderHook(() => useProjectMedia(''))
    await act(async () => { await result.current.load() })
    expect(getProjectFileTreeApi).not.toHaveBeenCalled()
  })

  it('目录读不到时给空列表并标记失败', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: 20100, data: null })

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => { await result.current.load() })

    expect(result.current.files).toEqual([])
    expect(result.current.loadFailed).toBe(true)
  })

  it('请求抛异常时也给空列表并标记失败', async () => {
    getProjectFileTreeApi.mockRejectedValue(new Error('network'))

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => { await result.current.load() })

    expect(result.current.loadFailed).toBe(true)
  })
})

describe('useProjectMedia 解析单张图', () => {
  /** 名片里有 OSS 地址就直接用，省掉一次原件下载 */
  it('名片里有 OSS 地址就用 OSS', async () => {
    readProjectFileApi.mockResolvedValue({ code: 0, data: { content: '---\noss: https://oss.example/a.png\n---\n' } })

    const { result } = renderHook(() => useProjectMedia('p1'))
    let preview: unknown
    await act(async () => { preview = await result.current.resolve('media/a.png') })

    expect(preview).toEqual({ url: 'https://oss.example/a.png', ossUrl: 'https://oss.example/a.png' })
    expect(downloadProjectFileApi).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.previews['media/a.png']).toBeTruthy())
  })

  /** 名片在但还没传上云，本地预览照样得看得见 */
  it('名片里没有 OSS 地址时退回下载原件', async () => {
    readProjectFileApi.mockResolvedValue({ code: 0, data: { content: '---\nalt: 封面\n---\n' } })
    downloadProjectFileApi.mockResolvedValue(new Blob(['x']))

    const { result } = renderHook(() => useProjectMedia('p1'))
    let preview: { url: string, ossUrl: string } | null = null
    await act(async () => { preview = await result.current.resolve('media/a.png') })

    expect(preview).toEqual({ url: 'blob:local', ossUrl: '' })
    expect(downloadProjectFileApi).toHaveBeenCalledWith('p1', 'media/a.png')
  })

  it('压根没有名片时也退回下载原件', async () => {
    readProjectFileApi.mockResolvedValue({ code: 20100, data: null })
    downloadProjectFileApi.mockResolvedValue(new Blob(['x']))

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => { await result.current.resolve('media/a.png') })

    // 两种名片写法都试过了才去下载原件
    expect(readProjectFileApi).toHaveBeenCalledTimes(2)
    expect(downloadProjectFileApi).toHaveBeenCalled()
  })

  it('解析过的图直接给回缓存，不再打接口', async () => {
    readProjectFileApi.mockResolvedValue({ code: 0, data: { content: '---\noss: https://oss.example/a.png\n---\n' } })

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => { await result.current.resolve('media/a.png') })
    readProjectFileApi.mockClear()

    await act(async () => { await result.current.resolve('media/a.png') })

    expect(readProjectFileApi).not.toHaveBeenCalled()
  })

  /** 一个网格里同一张图会被好几个格子同时请求，不合流就会下载好几遍 */
  it('同一张图并发解析只跑一次', async () => {
    readProjectFileApi.mockResolvedValue({ code: 0, data: { content: '---\noss: https://oss.example/a.png\n---\n' } })

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => {
      await Promise.all([
        result.current.resolve('media/a.png'),
        result.current.resolve('media/a.png'),
        result.current.resolve('media/a.png'),
      ])
    })

    expect(readProjectFileApi).toHaveBeenCalledTimes(1)
  })

  it('解析失败的图记下来，不会一直重试', async () => {
    readProjectFileApi.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useProjectMedia('p1'))
    await act(async () => {
      await expect(result.current.resolve('media/a.png')).resolves.toBeNull()
    })
    await waitFor(() => expect(result.current.failed['media/a.png']).toBe(true))
    readProjectFileApi.mockClear()

    await act(async () => {
      await expect(result.current.resolve('media/a.png')).resolves.toBeNull()
    })

    expect(readProjectFileApi).not.toHaveBeenCalled()
  })

  /** blob 地址不回收就是实打实的内存泄漏 */
  it('卸载时回收下载原件生成的 blob 地址', async () => {
    readProjectFileApi.mockResolvedValue({ code: 20100, data: null })
    downloadProjectFileApi.mockResolvedValue(new Blob(['x']))

    const { result, unmount } = renderHook(() => useProjectMedia('p1'))
    await act(async () => { await result.current.resolve('media/a.png') })

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local')
  })
})
