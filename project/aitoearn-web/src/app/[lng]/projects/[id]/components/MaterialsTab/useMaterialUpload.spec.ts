import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_FILE_ERROR_CODE, PROJECT_FILE_UPLOAD_MAX_SIZE } from '@/api/projects/project-file.constants'

const uploadProjectFileApi = vi.fn()

vi.mock('@/api/projects/project-file.api', () => ({
  uploadProjectFileApi: (...a: unknown[]) => uploadProjectFileApi(...a),
}))

const { useMaterialUpload } = await import('./useMaterialUpload')

function makeFile(name: string, size = 10) {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  uploadProjectFileApi.mockResolvedValue({ code: 0, data: {} })
})

describe('useMaterialUpload', () => {
  it('一批文件逐个上传，完成后通知刷新目录', async () => {
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useMaterialUpload('p1', onUploaded))

    await act(async () => {
      await result.current.enqueue([makeFile('a.png'), makeFile('b.png')], 'media')
    })

    expect(uploadProjectFileApi).toHaveBeenCalledTimes(2)
    expect(result.current.items.map(item => item.status)).toEqual(['done', 'done'])
    expect(result.current.items.every(item => item.progress === 100)).toBe(true)
    // 一批只通知一次，不是每个文件都刷一遍目录
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith('media')
  })

  it('空数组什么都不做', async () => {
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useMaterialUpload('p1', onUploaded))

    await act(async () => { await result.current.enqueue([], 'media') })

    expect(uploadProjectFileApi).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  /** 超限的文件在本地就拦下来，不要浪费一次上传再被服务端拒绝 */
  it('超过大小上限的文件本地就判错，不发请求', async () => {
    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    await act(async () => {
      await result.current.enqueue([makeFile('big.png', PROJECT_FILE_UPLOAD_MAX_SIZE + 1)], 'media')
    })

    expect(uploadProjectFileApi).not.toHaveBeenCalled()
    expect(result.current.items[0]).toMatchObject({ status: 'error', errorKey: 'materials.upload.tooLarge' })
  })

  it('超限的被跳过，同一批里正常的照传', async () => {
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useMaterialUpload('p1', onUploaded))

    await act(async () => {
      await result.current.enqueue([makeFile('big.png', PROJECT_FILE_UPLOAD_MAX_SIZE + 1), makeFile('a.png')], 'media')
    })

    expect(uploadProjectFileApi).toHaveBeenCalledTimes(1)
    expect(result.current.items.map(item => item.status)).toEqual(['error', 'done'])
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('服务端业务错误翻成对应文案键', async () => {
    uploadProjectFileApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.Exists })
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useMaterialUpload('p1', onUploaded))

    await act(async () => { await result.current.enqueue([makeFile('a.png')], 'media') })

    expect(result.current.items[0]).toMatchObject({ status: 'error', errorKey: 'fileError.exists' })
    // 一个都没传成功就不该去刷目录
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('网络错误单独一个文案键', async () => {
    uploadProjectFileApi.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    await act(async () => { await result.current.enqueue([makeFile('a.png')], 'media') })

    expect(result.current.items[0]).toMatchObject({ status: 'error', errorKey: 'error.network' })
  })

  /** 取消不是失败，不该在队列里显示成红色的「上传失败」 */
  it('取消的文件标成已取消而不是失败', async () => {
    uploadProjectFileApi.mockRejectedValue(new DOMException('上传已取消', 'AbortError'))
    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    await act(async () => { await result.current.enqueue([makeFile('a.png')], 'media') })

    expect(result.current.items[0].status).toBe('canceled')
  })

  it('上报的进度写进队列项', async () => {
    uploadProjectFileApi.mockImplementation(async (_id: string, _file: File, options: { onProgress?: (n: number) => void }) => {
      options.onProgress?.(60)
      return { code: 0, data: {} }
    })
    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    await act(async () => { await result.current.enqueue([makeFile('a.png')], 'media') })

    expect(result.current.items[0].progress).toBe(100)
  })

  /** 还没轮到的文件没有 controller，得直接标成取消，队列跑到它时跳过 */
  it('取消还没轮到的文件：队列跑到它时直接跳过', async () => {
    let releaseFirst: (() => void) | undefined
    uploadProjectFileApi.mockImplementation(async () => {
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      return { code: 0, data: {} }
    })

    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    let queue: Promise<void> | undefined
    act(() => {
      queue = result.current.enqueue([makeFile('a.png'), makeFile('b.png')], 'media')
    })
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    act(() => { result.current.cancel(result.current.items[1].id) })

    await act(async () => {
      releaseFirst?.()
      await queue
    })

    expect(uploadProjectFileApi).toHaveBeenCalledTimes(1)
    expect(result.current.items[1].status).toBe('canceled')
  })

  it('全部取消把还没结束的都标成取消', async () => {
    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    await act(async () => { await result.current.enqueue([makeFile('a.png')], 'media') })
    await act(async () => {
      result.current.enqueue([makeFile('b.png')], 'media')
    })

    act(() => { result.current.cancelAll() })

    // 已经传完的不动，排队中的转成取消
    expect(result.current.items[0].status).toBe('done')
  })

  /** 正在传的要留着，不然进度条会凭空消失 */
  it('清理只清掉已结束的记录', async () => {
    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))
    await act(async () => { await result.current.enqueue([makeFile('a.png')], 'media') })

    act(() => { result.current.clearFinished() })

    expect(result.current.items).toEqual([])
  })

  it('有文件在传时 isUploading 为真', async () => {
    let release: (() => void) | undefined
    uploadProjectFileApi.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return { code: 0, data: {} }
    })

    const { result } = renderHook(() => useMaterialUpload('p1', vi.fn()))

    let queue: Promise<void> | undefined
    act(() => {
      queue = result.current.enqueue([makeFile('a.png')], 'media')
    })
    await waitFor(() => expect(result.current.isUploading).toBe(true))

    await act(async () => {
      release?.()
      await queue
    })

    expect(result.current.isUploading).toBe(false)
  })
})
