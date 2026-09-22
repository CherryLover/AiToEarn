import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAngleApi = vi.fn()
const deleteAngleApi = vi.fn()
const deriveAngleApi = vi.fn()
const getAngleListApi = vi.fn()
const syncAnglesApi = vi.fn()
const updateAngleApi = vi.fn()

vi.mock('@/api/angles/angle.api', () => ({
  createAngleApi: (...a: unknown[]) => createAngleApi(...a),
  deleteAngleApi: (...a: unknown[]) => deleteAngleApi(...a),
  deriveAngleApi: (...a: unknown[]) => deriveAngleApi(...a),
  getAngleListApi: (...a: unknown[]) => getAngleListApi(...a),
  syncAnglesApi: (...a: unknown[]) => syncAnglesApi(...a),
  updateAngleApi: (...a: unknown[]) => updateAngleApi(...a),
}))

const { useAngles } = await import('./useAngles')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getAngleListApi.mockResolvedValue({ code: 0, data: [] })
})

async function mounted(projectId = 'p1') {
  const hook = renderHook(() => useAngles(projectId))
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
  return hook
}

describe('useAngles 加载', () => {
  /** angles 只装已采用的：待确认那份单独拉，不能混进演进树和状态分组 */
  it('只把已采用的方向拉进列表', async () => {
    getAngleListApi.mockResolvedValue({ code: 0, data: [{ id: 'a1' }, { id: 'a2' }] })

    const { result } = await mounted()

    expect(getAngleListApi).toHaveBeenCalledWith('p1', { confirmed: true })
    expect(getAngleListApi).toHaveBeenCalledWith('p1', { confirmed: false })
    expect(result.current.angles).toHaveLength(2)
    expect(result.current.loadFailed).toBe(false)
  })

  it('没有项目 id 时不发请求', async () => {
    renderHook(() => useAngles(''))
    await act(async () => {})
    expect(getAngleListApi).not.toHaveBeenCalled()
  })

  it('业务错误或结构不对都标记加载失败', async () => {
    getAngleListApi.mockResolvedValue({ code: 20200, data: null })
    const { result } = await mounted()
    expect(result.current.loadFailed).toBe(true)
    expect(result.current.angles).toEqual([])
  })

  it('请求抛异常时清空并标记失败', async () => {
    getAngleListApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()
    expect(result.current.loadFailed).toBe(true)
  })
})

describe('useAngles 增删改', () => {
  it('新建成功后整份重拉', async () => {
    createAngleApi.mockResolvedValue({ code: 0, data: { id: 'a1' } })
    const { result } = await mounted()
    getAngleListApi.mockClear()

    await act(async () => {
      await expect(result.current.create({ slug: 'a-b', name: '甲' } as never))
        .resolves
        .toEqual({ ok: true, angle: { id: 'a1' } })
    })

    expect(getAngleListApi).toHaveBeenCalledTimes(1)
  })

  /** 失败时要把业务码带回去，页面才能显示「slug 被占用」而不是「未知错误」 */
  it('新建失败把业务码带回去', async () => {
    createAngleApi.mockResolvedValue({ code: 20202 })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.create({ slug: 'a-b', name: '甲' } as never))
        .resolves
        .toEqual({ ok: false, code: 20202 })
    })
  })

  it('请求本身挂掉时不带业务码', async () => {
    createAngleApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.create({ slug: 'a-b', name: '甲' } as never)).resolves.toEqual({ ok: false })
    })
  })

  it('派生成功后整份重拉', async () => {
    deriveAngleApi.mockResolvedValue({ code: 0, data: { id: 'a2' } })
    const { result } = await mounted()
    getAngleListApi.mockClear()

    await act(async () => {
      await expect(result.current.derive('a1', { slug: 'a-b-2', name: '乙' } as never))
        .resolves
        .toMatchObject({ ok: true })
    })

    expect(deriveAngleApi).toHaveBeenCalledWith('p1', 'a1', { slug: 'a-b-2', name: '乙' })
    expect(getAngleListApi).toHaveBeenCalledTimes(1)
  })

  it('派生失败带回业务码', async () => {
    deriveAngleApi.mockResolvedValue({ code: 20206 })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.derive('a1', {} as never)).resolves.toEqual({ ok: false, code: 20206 })
    })
  })

  /** 改完状态要能立刻重排，为此服务端回了最新数据就地替换，不再多打一次列表 */
  it('改完之后服务端回了最新数据就就地替换，不重拉', async () => {
    getAngleListApi.mockResolvedValue({ code: 0, data: [{ id: 'a1', name: '旧' }] })
    updateAngleApi.mockResolvedValue({ code: 0, data: { id: 'a1', name: '新' } })
    const { result } = await mounted()
    getAngleListApi.mockClear()

    await act(async () => {
      await expect(result.current.update('a1', { name: '新' } as never)).resolves.toMatchObject({ ok: true })
    })

    expect(getAngleListApi).not.toHaveBeenCalled()
    expect(result.current.angles).toEqual([{ id: 'a1', name: '新' }])
  })

  /** 没回最新数据就必须重拉，不然页面显示的和库里对不上 */
  it('改完之后服务端没回数据就整份重拉', async () => {
    updateAngleApi.mockResolvedValue({ code: 0, data: null })
    const { result } = await mounted()
    getAngleListApi.mockClear()

    await act(async () => {
      await result.current.update('a1', { name: '新' } as never)
    })

    expect(getAngleListApi).toHaveBeenCalledTimes(1)
  })

  it('改失败带回业务码', async () => {
    updateAngleApi.mockResolvedValue({ code: 20209 })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.update('a1', {} as never)).resolves.toEqual({ ok: false, code: 20209 })
    })
  })

  it('删除成功后整份重拉', async () => {
    deleteAngleApi.mockResolvedValue({ code: 0, data: {} })
    const { result } = await mounted()
    getAngleListApi.mockClear()

    await act(async () => {
      await expect(result.current.remove('a1')).resolves.toEqual({ ok: true })
    })

    expect(getAngleListApi).toHaveBeenCalledTimes(1)
  })

  it('删除失败带回业务码（比如还有子方向）', async () => {
    deleteAngleApi.mockResolvedValue({ code: 20211 })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.remove('a1')).resolves.toEqual({ ok: false, code: 20211 })
    })
  })

  it('删除请求挂掉时不带业务码', async () => {
    deleteAngleApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.remove('a1')).resolves.toEqual({ ok: false })
    })
  })
})

/**
 * AI 技能只写文件不写库，少了登记这一步，提炼出来的方向永远进不了列表。
 * 登记接口回的就是登记之后的全量方向，直接换掉列表，不用再拉一次。
 */
describe('useAngles 登记 AI 写出来的方向文件', () => {
  /**
   * /sync 返回的是全量（已采用 + 待确认），不能直接拿来填列表——那样待确认的会混进演进树。
   * 所以登记完两份各自重拉一次。
   */
  it('登记成功后两份列表各自重拉，不拿返回值直接填', async () => {
    syncAnglesApi.mockResolvedValue({ code: 0, data: [{ id: 'a1' }, { id: 'a2' }] })
    getAngleListApi.mockResolvedValue({ code: 0, data: [{ id: 'a1' }] })
    const { result } = await mounted()
    getAngleListApi.mockClear()

    await act(async () => {
      await expect(result.current.sync()).resolves.toEqual({ ok: true })
    })

    expect(getAngleListApi).toHaveBeenCalledWith('p1', { confirmed: true })
    expect(getAngleListApi).toHaveBeenCalledWith('p1', { confirmed: false })
    expect(result.current.loadFailed).toBe(false)
  })

  it('登记失败带回业务码', async () => {
    syncAnglesApi.mockResolvedValue({ code: 20218 })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.sync()).resolves.toEqual({ ok: false, code: 20218 })
    })
  })

  it('登记请求挂掉时不带业务码', async () => {
    syncAnglesApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.sync()).resolves.toEqual({ ok: false })
    })
  })
})
