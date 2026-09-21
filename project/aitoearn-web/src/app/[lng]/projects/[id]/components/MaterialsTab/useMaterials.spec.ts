import type { FileNode } from '@/api/projects/project-file.types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_FILE_ERROR_CODE } from '@/api/projects/project-file.constants'
import { ProjectFileType } from '@/api/projects/project-file.types'

const deleteProjectFileApi = vi.fn()
const getProjectFileTreeApi = vi.fn()
const mkdirProjectFileApi = vi.fn()
const renameProjectFileApi = vi.fn()

vi.mock('@/api/projects/project-file.api', () => ({
  deleteProjectFileApi: (...a: unknown[]) => deleteProjectFileApi(...a),
  getProjectFileTreeApi: (...a: unknown[]) => getProjectFileTreeApi(...a),
  mkdirProjectFileApi: (...a: unknown[]) => mkdirProjectFileApi(...a),
  renameProjectFileApi: (...a: unknown[]) => renameProjectFileApi(...a),
}))

const { useMaterials } = await import('./useMaterials')

function dir(path: string, children: FileNode[] | null): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.Dir, size: null, updatedAt: '', children }
}
function file(path: string): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.File, size: 1, updatedAt: '', children: null }
}

function fullTree() {
  return dir('', [
    dir('background', [file('background/a.md')]),
    dir('media', null),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectFileTreeApi.mockResolvedValue({ code: 0, data: fullTree() })
})

async function mounted(projectId = 'p1') {
  const hook = renderHook(() => useMaterials(projectId))
  await waitFor(() => expect(hook.result.current.isTreeLoading).toBe(false))
  return hook
}

describe('useMaterials 目录树', () => {
  it('首屏拉整棵树', async () => {
    const { result } = await mounted()

    expect(getProjectFileTreeApi).toHaveBeenCalledWith('p1', { depth: expect.any(Number) })
    expect(result.current.tree?.children).toHaveLength(2)
    expect(result.current.treeFailed).toBe(false)
  })

  it('没有项目 id 时不发请求', async () => {
    renderHook(() => useMaterials(''))
    await act(async () => {})
    expect(getProjectFileTreeApi).not.toHaveBeenCalled()
  })

  it('业务错误和异常都标记失败', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.NotFound, data: null })
    const { result } = await mounted()
    expect(result.current.treeFailed).toBe(true)
    expect(result.current.tree).toBeNull()
  })

  it('请求抛异常时清空并标记失败', async () => {
    getProjectFileTreeApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()
    expect(result.current.treeFailed).toBe(true)
  })

  /** 进来就该看到物料往哪放，所以根目录和 background 默认展开 */
  it('根目录和 background 默认展开', async () => {
    const { result } = await mounted()
    expect(result.current.isExpanded('')).toBe(true)
    expect(result.current.isExpanded('background')).toBe(true)
    expect(result.current.isExpanded('media')).toBe(false)
  })
})

describe('useMaterials 展开', () => {
  /** 树的层数有上限，深目录的 children 是 null，展开时得再单独拉一次，否则永远是空的 */
  it('展开 children 为 null 的目录会再拉一次子树', async () => {
    const { result } = await mounted()
    getProjectFileTreeApi.mockResolvedValue({ code: 0, data: dir('media', [file('media/a.png')]) })

    await act(async () => { result.current.expandPath(dir('media', null)) })

    await waitFor(() => expect(getProjectFileTreeApi).toHaveBeenCalledWith('p1', { path: 'media', depth: expect.any(Number) }))
    await waitFor(() => expect(result.current.isExpanded('media')).toBe(true))
  })

  it('已经有 children 的目录展开时不再请求', async () => {
    const { result } = await mounted()
    getProjectFileTreeApi.mockClear()

    await act(async () => { result.current.expandPath(dir('background', [file('background/a.md')])) })

    expect(getProjectFileTreeApi).not.toHaveBeenCalled()
  })

  it('文件不是目录，展开它是空操作', async () => {
    const { result } = await mounted()

    act(() => { result.current.expandPath(file('background/a.md')) })

    expect(result.current.isExpanded('background/a.md')).toBe(false)
  })

  it('toggle 来回切展开状态', async () => {
    const { result } = await mounted()

    act(() => { result.current.toggleExpand(dir('background', [])) })
    expect(result.current.isExpanded('background')).toBe(false)

    act(() => { result.current.toggleExpand(dir('background', [])) })
    expect(result.current.isExpanded('background')).toBe(true)
  })

  it('toggle 文件是空操作', async () => {
    const { result } = await mounted()
    act(() => { result.current.toggleExpand(file('background/a.md')) })
    expect(result.current.isExpanded('background/a.md')).toBe(false)
  })

  /** 上传完要让新文件所在的目录自己展开，人得看见文件真的进来了 */
  it('按路径展开会把所有上级一起展开', async () => {
    const { result } = await mounted()

    act(() => { result.current.expandDirPath('background/product/2026') })

    expect(result.current.isExpanded('background')).toBe(true)
    expect(result.current.isExpanded('background/product')).toBe(true)
    expect(result.current.isExpanded('background/product/2026')).toBe(true)
  })

  it('按空路径展开只展开根', async () => {
    const { result } = await mounted()
    act(() => { result.current.expandDirPath('') })
    expect(result.current.isExpanded('')).toBe(true)
  })
})

describe('useMaterials 选中', () => {
  it('选中节点后能读到它', async () => {
    const { result } = await mounted()

    act(() => { result.current.selectNode(file('background/a.md')) })

    expect(result.current.selectedNode?.path).toBe('background/a.md')
  })

  it('取消选中', async () => {
    const { result } = await mounted()
    act(() => { result.current.selectNode(file('background/a.md')) })

    act(() => { result.current.selectNode(null) })

    expect(result.current.selectedNode).toBeNull()
  })

  /** 选中的东西被别的端删掉之后树上就没有了，这时候当作没选中，不能挂着一个幽灵节点 */
  it('选中的路径在树上找不到时当作没选中', async () => {
    const { result } = await mounted()

    act(() => { result.current.selectPath('已经不存在.md') })

    expect(result.current.selectedNode).toBeNull()
  })
})

describe('useMaterials 增删改', () => {
  it('建目录成功后重拉树', async () => {
    mkdirProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    const { result } = await mounted()
    getProjectFileTreeApi.mockClear()

    await act(async () => {
      await expect(result.current.createFolder('media/new')).resolves.toEqual({ ok: true })
    })

    expect(mkdirProjectFileApi).toHaveBeenCalledWith('p1', { path: 'media/new' })
    expect(getProjectFileTreeApi).toHaveBeenCalledTimes(1)
  })

  it('建目录失败带回业务码', async () => {
    mkdirProjectFileApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.Exists })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.createFolder('media/new'))
        .resolves
        .toEqual({ ok: false, code: PROJECT_FILE_ERROR_CODE.Exists })
    })
  })

  it('建目录请求挂掉时不带业务码', async () => {
    mkdirProjectFileApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.createFolder('media/new')).resolves.toEqual({ ok: false })
    })
  })

  /** 改完名还选着旧路径的话，右边面板会显示「文件不存在」 */
  it('改名后选中项和展开状态跟着换到新路径', async () => {
    renameProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    getProjectFileTreeApi.mockResolvedValue({
      code: 0,
      data: dir('', [dir('背景', [file('背景/a.md')])]),
    })
    const { result } = await mounted()
    act(() => { result.current.selectPath('background') })

    await act(async () => {
      await expect(result.current.renameNode('background', '背景')).resolves.toEqual({ ok: true })
    })

    expect(renameProjectFileApi).toHaveBeenCalledWith('p1', { from: 'background', to: '背景' })
    expect(result.current.selectedNode?.path).toBe('背景')
    expect(result.current.isExpanded('背景')).toBe(true)
    expect(result.current.isExpanded('background')).toBe(false)
  })

  it('改名失败带回业务码', async () => {
    renameProjectFileApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.PathInvalid })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.renameNode('a', 'b'))
        .resolves
        .toEqual({ ok: false, code: PROJECT_FILE_ERROR_CODE.PathInvalid })
    })
  })

  it('改名请求挂掉时不带业务码', async () => {
    renameProjectFileApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.renameNode('a', 'b')).resolves.toEqual({ ok: false })
    })
  })

  /** 删掉一个目录，选中的子文件也一并失效，展开状态同理 */
  it('删除后清掉选中和展开状态，连同它的子路径', async () => {
    deleteProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    const { result } = await mounted()
    act(() => {
      result.current.expandDirPath('background/product')
      result.current.selectPath('background/a.md')
    })

    await act(async () => {
      await expect(result.current.deleteNode('background')).resolves.toEqual({ ok: true })
    })

    expect(result.current.selectedNode).toBeNull()
    expect(result.current.isExpanded('background')).toBe(false)
    expect(result.current.isExpanded('background/product')).toBe(false)
  })

  it('删的不是选中那一支时选中项保留', async () => {
    deleteProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    const { result } = await mounted()
    act(() => { result.current.selectPath('background/a.md') })

    await act(async () => { await result.current.deleteNode('media') })

    expect(result.current.selectedNode?.path).toBe('background/a.md')
  })

  it('删除失败带回业务码', async () => {
    deleteProjectFileApi.mockResolvedValue({ code: PROJECT_FILE_ERROR_CODE.NotFound })
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.deleteNode('a'))
        .resolves
        .toEqual({ ok: false, code: PROJECT_FILE_ERROR_CODE.NotFound })
    })
  })

  it('删除请求挂掉时不带业务码', async () => {
    deleteProjectFileApi.mockRejectedValue(new Error('network'))
    const { result } = await mounted()

    await act(async () => {
      await expect(result.current.deleteNode('a')).resolves.toEqual({ ok: false })
    })
  })
})
