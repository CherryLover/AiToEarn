import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 上传和下载不走统一的 http 封装（要进度、要二进制、要能中途取消），
 * 所以鉴权头、地址拼接、取消语义全是这一层自己写的，也就得自己测。
 */

vi.mock('@/store/user', () => ({
  useUserStore: { getState: () => ({ token: 'test-token', lang: 'zh-CN' }) },
}))

const { downloadProjectFileApi, uploadProjectFileApi } = await import('../projects/project-file.api')

interface XhrStub {
  open: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  setRequestHeader: ReturnType<typeof vi.fn>
  responseText: string
  status: number
  fire: (event: string) => void
  fireUploadProgress: (loaded: number, total: number) => void
}

function stubXhr(): XhrStub {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  const uploadListeners = new Map<string, Array<(event: unknown) => void>>()

  const stub: XhrStub = {
    open: vi.fn(),
    send: vi.fn(),
    abort: vi.fn(),
    setRequestHeader: vi.fn(),
    responseText: '{"code":0,"data":{"name":"a.png"}}',
    status: 200,
    fire: event => listeners.get(event)?.forEach(fn => fn({})),
    fireUploadProgress: (loaded, total) =>
      uploadListeners.get('progress')?.forEach(fn => fn({ lengthComputable: true, loaded, total })),
  }

  const instance = {
    open: stub.open,
    send: stub.send,
    abort: stub.abort,
    setRequestHeader: stub.setRequestHeader,
    get responseText() { return stub.responseText },
    get status() { return stub.status },
    addEventListener: (event: string, fn: (e: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
    },
    upload: {
      addEventListener: (event: string, fn: (e: unknown) => void) => {
        uploadListeners.set(event, [...(uploadListeners.get(event) ?? []), fn])
      },
    },
  }

  // 必须是能 `new` 的普通函数：箭头函数没有 [[Construct]]，`new XMLHttpRequest()` 会直接抛
  function FakeXhr(this: unknown) {
    return instance
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  return stub
}

function makeFile() {
  return new File(['x'], 'a.png', { type: 'image/png' })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadProjectFileApi', () => {
  it('带上 Bearer 令牌和语言头，但不设 Content-Type', async () => {
    const xhr = stubXhr()
    const promise = uploadProjectFileApi('p1', makeFile(), { path: 'media' })
    xhr.fire('load')
    await promise

    expect(xhr.open).toHaveBeenCalledWith('POST', expect.stringContaining('/projects/p1/files/upload'))
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token')
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Accept-Language', 'zh-CN')
    // boundary 得交给浏览器自己带，手写 Content-Type 会把表单发坏
    expect(xhr.setRequestHeader).not.toHaveBeenCalledWith('Content-Type', expect.anything())
  })

  it('上报上传进度百分比', async () => {
    const xhr = stubXhr()
    const onProgress = vi.fn()
    const promise = uploadProjectFileApi('p1', makeFile(), { path: 'media', onProgress })

    xhr.fireUploadProgress(30, 120)
    xhr.fire('load')
    await promise

    expect(onProgress).toHaveBeenCalledWith(25)
  })

  it('返回服务端的响应体', async () => {
    const xhr = stubXhr()
    const promise = uploadProjectFileApi('p1', makeFile(), { path: 'media' })
    xhr.fire('load')

    await expect(promise).resolves.toEqual({ code: 0, data: { name: 'a.png' } })
  })

  /** 网关挂了会返回一段 HTML，JSON.parse 会炸，得翻成能看懂的错误 */
  it('响应不是 JSON 时报出状态码', async () => {
    const xhr = stubXhr()
    xhr.responseText = '<html>502</html>'
    xhr.status = 502
    const promise = uploadProjectFileApi('p1', makeFile(), { path: 'media' })
    xhr.fire('load')

    await expect(promise).rejects.toThrow('上传失败: 502')
  })

  it('网络错误单独报', async () => {
    const xhr = stubXhr()
    const promise = uploadProjectFileApi('p1', makeFile(), { path: 'media' })
    xhr.fire('error')

    await expect(promise).rejects.toThrow('上传失败: 网络错误')
  })

  /** 已经取消了就别再发请求出去 */
  it('传进来就是已取消的信号时直接拒绝，不发请求', async () => {
    const xhr = stubXhr()
    const controller = new AbortController()
    controller.abort()

    await expect(uploadProjectFileApi('p1', makeFile(), { path: 'media', signal: controller.signal }))
      .rejects
      .toThrow(DOMException)
    expect(xhr.send).not.toHaveBeenCalled()
  })

  it('中途取消会真的 abort 掉请求', async () => {
    const xhr = stubXhr()
    const controller = new AbortController()
    const promise = uploadProjectFileApi('p1', makeFile(), { path: 'media', signal: controller.signal })

    controller.abort()

    await expect(promise).rejects.toThrow(DOMException)
    expect(xhr.abort).toHaveBeenCalled()
  })
})

describe('downloadProjectFileApi', () => {
  it('把路径拼进查询串并带上鉴权头', async () => {
    const blob = new Blob(['x'])
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadProjectFileApi('p1', 'media/我的图.png')).resolves.toBe(blob)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/projects/p1/files/download')
    // 中文和斜杠都得编码，否则服务端拿到的是另一个路径
    expect(url).toContain(`path=${encodeURIComponent('media/我的图.png')}`)
    expect(init.headers.Authorization).toBe('Bearer test-token')
  })

  it('非 2xx 时抛出带状态码的错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(downloadProjectFileApi('p1', 'a.png')).rejects.toThrow('Download failed: 404')
  })
})
