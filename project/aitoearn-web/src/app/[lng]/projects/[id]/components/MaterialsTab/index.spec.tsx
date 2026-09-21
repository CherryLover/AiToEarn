import type { FileNode } from '@/api/projects/project-file.types'
import { chooseMenuItem } from '@test/radix'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFileType } from '@/api/projects/project-file.types'

const deleteProjectFileApi = vi.fn()
const downloadProjectFileApi = vi.fn()
const getProjectFileTreeApi = vi.fn()
const mkdirProjectFileApi = vi.fn()
const readProjectFileApi = vi.fn()
const renameProjectFileApi = vi.fn()
const uploadProjectFileApi = vi.fn()
const writeProjectFileApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/projects/project-file.api', () => ({
  deleteProjectFileApi: (...a: unknown[]) => deleteProjectFileApi(...a),
  downloadProjectFileApi: (...a: unknown[]) => downloadProjectFileApi(...a),
  getProjectFileTreeApi: (...a: unknown[]) => getProjectFileTreeApi(...a),
  mkdirProjectFileApi: (...a: unknown[]) => mkdirProjectFileApi(...a),
  readProjectFileApi: (...a: unknown[]) => readProjectFileApi(...a),
  renameProjectFileApi: (...a: unknown[]) => renameProjectFileApi(...a),
  uploadProjectFileApi: (...a: unknown[]) => uploadProjectFileApi(...a),
  writeProjectFileApi: (...a: unknown[]) => writeProjectFileApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))

const { MaterialsTab } = await import('./index')

function dir(path: string, children: FileNode[] | null): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.Dir, size: null, updatedAt: '2026-09-01T00:00:00.000Z', children }
}
function file(path: string, size = 12): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.File, size, updatedAt: '2026-09-01T00:00:00.000Z', children: null }
}

function tree() {
  return dir('', [
    dir('background', [dir('background/product', [file('background/product/spec.md')])]),
    dir('media', []),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectFileTreeApi.mockResolvedValue({ code: 0, data: tree() })
  readProjectFileApi.mockResolvedValue({ code: 0, data: { path: 'background/product/spec.md', content: '产品说明', size: 12, updatedAt: '2026-09-01T00:00:00.000Z' } })
})

async function renderTab(readOnly = false) {
  const view = render(<MaterialsTab projectId="p1" readOnly={readOnly} />)
  await waitFor(() => expect(getProjectFileTreeApi).toHaveBeenCalled())
  await screen.findByText('materials.rootLabel')
  return view
}

/** 左边的目录树，和右边概览里同名的目录卡片分开查 */
function treeRow(path: string) {
  return screen.getByTestId(`material-node-${path}`).closest('div') as HTMLElement
}

function treePanel() {
  return screen.getByText('materials.tree.title').closest('aside') as HTMLElement
}

describe('materialsTab 目录树', () => {
  it('首屏拉整棵树并把根和一级目录摆出来', async () => {
    await renderTab()

    const tree = treePanel()
    expect(within(tree).getByText('materials.rootLabel')).toBeInTheDocument()
    expect(within(tree).getByText('background')).toBeInTheDocument()
    expect(within(tree).getByText('media')).toBeInTheDocument()
  })

  it('拉树失败时给重试按钮', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: 20100, data: null })
    render(<MaterialsTab projectId="p1" readOnly={false} />)

    expect(await screen.findByText('materials.tree.loadFailed')).toBeInTheDocument()
    getProjectFileTreeApi.mockResolvedValue({ code: 0, data: tree() })

    await userEvent.click(screen.getByRole('button', { name: /action.retry/ }))

    expect(await screen.findByText('materials.rootLabel')).toBeInTheDocument()
  })

  /** 一进来什么都没选，右边先讲清楚每个标准目录该放什么 */
  it('没选中东西时右边是物料概览', async () => {
    await renderTab()

    expect(screen.getByText('materials.overview.title')).toBeInTheDocument()
    expect(screen.getByText('background/product')).toBeInTheDocument()
    expect(screen.getByText('materials.guide.media')).toBeInTheDocument()
  })

  it('从概览点一个目录就切到目录详情', async () => {
    await renderTab()

    await userEvent.click(screen.getByText('background/product'))

    expect(await screen.findByText('materials.guide.backgroundProduct')).toBeInTheDocument()
    expect(screen.getAllByText('spec.md').length).toBeGreaterThan(0)
  })

  it('点目录树里的文件就去读内容', async () => {
    await renderTab()

    // background 默认就是展开的，点一下 product 把里面的文件露出来
    await userEvent.click(screen.getByTestId('material-node-background/product'))
    await userEvent.click(await screen.findByTestId('material-node-background/product/spec.md'))

    await waitFor(() => expect(readProjectFileApi).toHaveBeenCalledWith('p1', 'background/product/spec.md'))
    expect(await screen.findByDisplayValue('产品说明')).toBeInTheDocument()
  })

  /** 归档项目只读：还能看，但上传、建文件夹、行内菜单都不给 */
  it('归档项目里不给动物料的入口', async () => {
    await renderTab(true)

    expect(screen.queryByRole('button', { name: /materials.menu.newFolder/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /materials.action.uploadTo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /materials.menu.more/ })).not.toBeInTheDocument()
  })
})

describe('materialsTab 建文件夹', () => {
  it('建在当前落点下，成功后提示一声', async () => {
    mkdirProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: /materials.menu.newFolder/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/materials.newFolder.label/), 'ads')
    await userEvent.click(within(dialog).getByRole('button', { name: /materials.newFolder.submit/ }))

    await waitFor(() => expect(mkdirProjectFileApi).toHaveBeenCalledWith('p1', { path: 'ads' }))
    expect(toastSuccess).toHaveBeenCalledWith('materials.newFolder.success')
  })

  /** 同名目录已经存在这类失败要把业务码翻成具体说法 */
  it('重名时把业务码翻成具体说法', async () => {
    mkdirProjectFileApi.mockResolvedValue({ code: 20104 })
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: /materials.menu.newFolder/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/materials.newFolder.label/), 'media')
    await userEvent.click(within(dialog).getByRole('button', { name: /materials.newFolder.submit/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('fileError.exists'))
  })

  it('名字不合法时提交按钮是灰的', async () => {
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: /materials.menu.newFolder/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/materials.newFolder.label/), 'a/b')

    expect(within(dialog).getByRole('button', { name: /materials.newFolder.submit/ })).toBeDisabled()
    expect(mkdirProjectFileApi).not.toHaveBeenCalled()
  })
})

describe('materialsTab 改名和删除', () => {
  it('从行内菜单改名，改的是同一个目录下的新名字', async () => {
    renameProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    await renderTab()

    const row = treeRow('media')
    await chooseMenuItem(within(row).getByRole('button', { name: /materials.menu.more/ }), 'materials.menu.rename')

    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText(/materials.rename.label/)
    await userEvent.clear(input)
    await userEvent.type(input, 'assets')
    await userEvent.click(within(dialog).getByRole('button', { name: /materials.rename.submit/ }))

    await waitFor(() => expect(renameProjectFileApi).toHaveBeenCalledWith('p1', { from: 'media', to: 'assets' }))
    expect(toastSuccess).toHaveBeenCalledWith('materials.rename.success')
  })

  /** 名字没改就别去麻烦服务端 */
  it('名字没动时不发改名请求', async () => {
    await renderTab()

    const row = treeRow('media')
    await chooseMenuItem(within(row).getByRole('button', { name: /materials.menu.more/ }), 'materials.menu.rename')

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /materials.rename.submit/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(renameProjectFileApi).not.toHaveBeenCalled()
  })

  it('删之前先确认，确认之后才真的删', async () => {
    deleteProjectFileApi.mockResolvedValue({ code: 0, data: { path: 'media' } })
    await renderTab()

    const row = treeRow('media')
    await chooseMenuItem(within(row).getByRole('button', { name: /materials.menu.more/ }), 'materials.menu.delete')

    expect(await screen.findByText('materials.delete.title')).toBeInTheDocument()
    expect(deleteProjectFileApi).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /materials.delete.confirm/ }))

    await waitFor(() => expect(deleteProjectFileApi).toHaveBeenCalledWith('p1', { path: 'media' }))
    expect(toastSuccess).toHaveBeenCalledWith('materials.delete.success')
  })

  it('删失败时把业务码翻成具体说法', async () => {
    deleteProjectFileApi.mockResolvedValue({ code: 20106 })
    await renderTab()

    const row = treeRow('media')
    await chooseMenuItem(within(row).getByRole('button', { name: /materials.menu.more/ }), 'materials.menu.delete')
    await userEvent.click(await screen.findByRole('button', { name: /materials.delete.confirm/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('fileError.isSymlink'))
  })
})

describe('materialsTab 上传', () => {
  /** 上传落点跟着选中项走：选了目录就传进那个目录 */
  it('选中目录之后上传按钮指向那个目录', async () => {
    await renderTab()

    expect(screen.getByRole('button', { name: /materials.action.uploadTo/ })).toBeInTheDocument()

    await userEvent.click(screen.getByText('background/product'))

    await waitFor(() => expect(screen.getByText('materials.guide.backgroundProduct')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /materials.action.uploadTo/ })).toBeInTheDocument()
  })

  it('选好文件就排进上传队列', async () => {
    uploadProjectFileApi.mockResolvedValue({ code: 0, data: {} })
    const { container } = await renderTab()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['hi'], 'note.txt', { type: 'text/plain' }))

    await waitFor(() => expect(uploadProjectFileApi).toHaveBeenCalled())
    expect(uploadProjectFileApi.mock.calls[0][1].name).toBe('note.txt')
    expect(await screen.findByText('note.txt')).toBeInTheDocument()
  })
})
