import type { ProjectMediaLibrary } from './useProjectMedia'
import type { FileNode } from '@/api/projects/project-file.types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFileType } from '@/api/projects/project-file.types'

/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))

const { MediaPickerDialog } = await import('./MediaPickerDialog')

function image(path: string): FileNode {
  return {
    name: path.split('/').pop() ?? '',
    path,
    type: ProjectFileType.File,
    size: 1024,
    updatedAt: '2026-09-01T00:00:00.000Z',
    children: null,
  }
}

const load = vi.fn(async () => {})
const resolve = vi.fn(async (path: string) => ({ url: `https://oss/${path}`, ossUrl: `https://oss/${path}` }))

function library(overrides: Partial<ProjectMediaLibrary> = {}): ProjectMediaLibrary {
  const files = overrides.files ?? [image('media/a.png'), image('media/b.png'), image('media/c.png')]
  return {
    files,
    isLoading: false,
    loadFailed: false,
    truncated: false,
    previews: Object.fromEntries(files.map(f => [f.path, { url: `https://oss/${f.path}`, ossUrl: `https://oss/${f.path}` }])),
    failed: {},
    load,
    resolve,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resolve.mockImplementation(async (path: string) => ({ url: `https://oss/${path}`, ossUrl: `https://oss/${path}` }))
})

function renderDialog(lib = library(), props: { existingUrls?: string[], pickedPaths?: string[] } = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <MediaPickerDialog
      open
      onOpenChange={onOpenChange}
      library={lib}
      existingUrls={props.existingUrls ?? []}
      pickedPaths={props.pickedPaths ?? []}
      onConfirm={onConfirm}
    />,
  )
  return { onConfirm, onOpenChange, ...view }
}

/** 已选那一栏，跟上面的缩略图网格分开查 */
function selectedPanel() {
  return screen.getByText('publish.mediaPicker.selectedHint').closest('div') as HTMLElement
}

describe('mediaPickerDialog 列图', () => {
  /** 人很可能刚在「物料」标签页传了新图，所以每次打开都重列一遍 */
  it('一打开就重新列一遍 media/', async () => {
    renderDialog()

    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(screen.getByAltText('a.png')).toBeInTheDocument()
  })

  it('列失败时给重试', async () => {
    renderDialog(library({ loadFailed: true, files: [] }))

    await userEvent.click(screen.getByRole('button', { name: /publish.mediaPicker.retry/ }))

    // 一次是打开时自己拉的，一次是点重试
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('一张图都没有时说去哪儿传', () => {
    renderDialog(library({ files: [] }))

    expect(screen.getByText('publish.mediaPicker.empty')).toBeInTheDocument()
    expect(screen.getByText('publish.mediaPicker.emptyHint')).toBeInTheDocument()
  })

  it('图太多被截断时说一声', () => {
    renderDialog(library({ truncated: true }))

    expect(screen.getByText('publish.mediaPicker.truncated')).toBeInTheDocument()
  })

  /** 已经在配图里的不该再挑一遍 */
  it('已经挑过的图不给再点', () => {
    renderDialog(library(), { pickedPaths: ['media/a.png'] })

    expect(screen.getByAltText('a.png').closest('button')).toBeDisabled()
    expect(screen.getByAltText('b.png').closest('button')).toBeEnabled()
  })

  it('快照里已经有同一个 OSS 地址的也不给再点', () => {
    renderDialog(library(), { existingUrls: ['https://oss/media/b.png'] })

    expect(screen.getByAltText('b.png').closest('button')).toBeDisabled()
  })
})

describe('mediaPickerDialog 挑图和排序', () => {
  it('点一下选中并标上序号，再点一下取消', async () => {
    renderDialog()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    expect(screen.getByAltText('a.png').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(within(selectedPanel()).getByText('media/a.png')).toBeInTheDocument()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    expect(screen.queryByText('publish.mediaPicker.selectedHint')).not.toBeInTheDocument()
  })

  it('选中的顺序能调，调完确认按调好的顺序给回去', async () => {
    const { onConfirm } = renderDialog()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    await userEvent.click(screen.getByAltText('b.png').closest('button') as HTMLElement)

    const rows = within(selectedPanel()).getAllByRole('listitem')
    await userEvent.click(within(rows[1]).getByRole('button', { name: /publish.mediaPicker.moveUp/ }))
    await userEvent.click(screen.getByRole('button', { name: /publish.mediaPicker.confirm/ }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm.mock.calls[0][0].map((item: { path: string }) => item.path)).toEqual(['media/b.png', 'media/a.png'])
  })

  it('第一项不能再往上，最后一项不能再往下', async () => {
    renderDialog()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    await userEvent.click(screen.getByAltText('b.png').closest('button') as HTMLElement)

    const rows = within(selectedPanel()).getAllByRole('listitem')
    expect(within(rows[0]).getByRole('button', { name: /publish.mediaPicker.moveUp/ })).toBeDisabled()
    expect(within(rows[1]).getByRole('button', { name: /publish.mediaPicker.moveDown/ })).toBeDisabled()
  })

  it('清空把选中的都去掉', async () => {
    renderDialog()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /publish.mediaPicker.clear/ }))

    expect(screen.queryByText('publish.mediaPicker.selectedHint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish.mediaPicker.confirm/ })).toBeDisabled()
  })

  it('从已选列表里直接移掉一张', async () => {
    renderDialog()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    await userEvent.click(within(selectedPanel()).getByRole('button', { name: /publish.mediaPicker.remove/ }))

    expect(screen.queryByText('publish.mediaPicker.selectedHint')).not.toBeInTheDocument()
  })
})

describe('mediaPickerDialog 确认', () => {
  it('确认时补一遍地址解析，然后把挑好的交回去并关掉', async () => {
    const { onConfirm, onOpenChange } = renderDialog()

    await userEvent.click(screen.getByAltText('c.png').closest('button') as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /publish.mediaPicker.confirm/ }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([
      { path: 'media/c.png', name: 'c.png', url: 'https://oss/media/c.png', ossUrl: 'https://oss/media/c.png' },
    ]))
    expect(resolve).toHaveBeenCalledWith('media/c.png')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  /** 地址解析不出来的那张就别放进去，免得卡片上挂一个空图 */
  it('地址解析不出来的图不放进结果里', async () => {
    // 缩略图滚进视野时自己也会解析一次，所以这里整场都让它解析不出来
    resolve.mockResolvedValue(null as unknown as { url: string, ossUrl: string })
    const { onConfirm } = renderDialog()

    await userEvent.click(screen.getByAltText('a.png').closest('button') as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /publish.mediaPicker.confirm/ }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith([]))
  })

  it('一张都没选时确认是灰的，取消直接关掉', async () => {
    const { onOpenChange } = renderDialog()

    expect(screen.getByRole('button', { name: /publish.mediaPicker.confirm/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /publish.mediaPicker.cancel/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
