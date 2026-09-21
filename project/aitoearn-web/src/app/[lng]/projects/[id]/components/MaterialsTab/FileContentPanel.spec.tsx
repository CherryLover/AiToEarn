import type { FileNode } from '@/api/projects/project-file.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFileType } from '@/api/projects/project-file.types'

const downloadProjectFileApi = vi.fn()
const readProjectFileApi = vi.fn()
const writeProjectFileApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/projects/project-file.api', () => ({
  downloadProjectFileApi: (...a: unknown[]) => downloadProjectFileApi(...a),
  readProjectFileApi: (...a: unknown[]) => readProjectFileApi(...a),
  writeProjectFileApi: (...a: unknown[]) => writeProjectFileApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))

const { FileContentPanel } = await import('./FileContentPanel')

function node(path: string, size = 20): FileNode {
  return {
    name: path.split('/').pop() ?? '',
    path,
    type: ProjectFileType.File,
    size,
    updatedAt: '2026-09-01T00:00:00.000Z',
    children: null,
  }
}

const createObjectURL = vi.fn(() => 'blob:preview')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // jsdom 没有 blob 地址这套，物料图片预览和下载都要用到
  vi.stubGlobal('URL', Object.assign(globalThis.URL, { createObjectURL, revokeObjectURL }))
})

function renderPanel(file: FileNode, readOnly = false) {
  const onSaved = vi.fn()
  const view = render(<FileContentPanel projectId="p1" node={file} readOnly={readOnly} onSaved={onSaved} />)
  return { onSaved, ...view }
}

describe('fileContentPanel 文本文件', () => {
  beforeEach(() => {
    readProjectFileApi.mockResolvedValue({
      code: 0,
      data: { path: 'background/spec.md', content: '第一版', size: 9, updatedAt: '2026-09-01T00:00:00.000Z' },
    })
  })

  it('读回来的内容进编辑框，没改之前存不了', async () => {
    renderPanel(node('background/spec.md'))

    expect(await screen.findByDisplayValue('第一版')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled()
  })

  it('改过之后能存，存完通知父级刷新目录树', async () => {
    writeProjectFileApi.mockResolvedValue({
      code: 0,
      data: { path: 'background/spec.md', content: '第二版', size: 9, updatedAt: '2026-09-02T00:00:00.000Z' },
    })
    const { onSaved } = renderPanel(node('background/spec.md'))

    const editor = await screen.findByDisplayValue('第一版')
    await userEvent.clear(editor)
    await userEvent.type(editor, '第二版')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(writeProjectFileApi).toHaveBeenCalledWith('p1', { path: 'background/spec.md', content: '第二版' }))
    expect(toastSuccess).toHaveBeenCalledWith('materials.editor.saveSuccess')
    expect(onSaved).toHaveBeenCalledTimes(1)
    // 存完就不再是「未保存」，按钮重新变灰
    await waitFor(() => expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled())
  })

  it('存失败时把业务码翻成具体说法，内容留在框里', async () => {
    writeProjectFileApi.mockResolvedValue({ code: 20105 })
    const { onSaved } = renderPanel(node('background/spec.md'))

    const editor = await screen.findByDisplayValue('第一版')
    await userEvent.type(editor, '补一句')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('fileError.writeFailed'))
    expect(screen.getByDisplayValue('第一版补一句')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('请求本身没通时说网络', async () => {
    writeProjectFileApi.mockRejectedValue(new Error('offline'))
    renderPanel(node('background/spec.md'))

    const editor = await screen.findByDisplayValue('第一版')
    await userEvent.type(editor, '!')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.network'))
  })

  /** 归档项目只读：还能看能下载，但不给存 */
  it('只读项目里没有保存按钮', async () => {
    renderPanel(node('background/spec.md'), true)

    await screen.findByDisplayValue('第一版')
    expect(screen.queryByRole('button', { name: /detail.save/ })).not.toBeInTheDocument()
  })
})

describe('fileContentPanel 非文本', () => {
  /** 扩展名就能看出不是文本的，别去打读接口白跑一趟 */
  it('认得出不是文本的扩展名，直接按二进制处理', async () => {
    renderPanel(node('media/clip.mp4'))

    expect(await screen.findByText('materials.preview.binary')).toBeInTheDocument()
    expect(readProjectFileApi).not.toHaveBeenCalled()
  })

  it('服务端说不是文本时按二进制处理，并把原因显示出来', async () => {
    readProjectFileApi.mockResolvedValue({ code: 20103 })
    renderPanel(node('background/spec.md'))

    expect(await screen.findByText('fileError.notText')).toBeInTheDocument()
  })

  it('文件太大时也是同样的处理', async () => {
    readProjectFileApi.mockResolvedValue({ code: 20102 })
    renderPanel(node('background/spec.md'))

    expect(await screen.findByText('fileError.tooLarge')).toBeInTheDocument()
  })

  it('下载点一下就走下载接口', async () => {
    downloadProjectFileApi.mockResolvedValue(new Blob(['x']))
    renderPanel(node('media/clip.mp4'))

    // 头上一个、正文里一个，点哪个都一样
    await userEvent.click((await screen.findAllByRole('button', { name: /materials.action.download/ }))[0])

    await waitFor(() => expect(downloadProjectFileApi).toHaveBeenCalledWith('p1', 'media/clip.mp4'))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('下载失败时说一声', async () => {
    downloadProjectFileApi.mockRejectedValue(new Error('offline'))
    renderPanel(node('media/clip.mp4'))

    await userEvent.click((await screen.findAllByRole('button', { name: /materials.action.download/ }))[0])

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('materials.preview.downloadFailed'))
  })
})

describe('fileContentPanel 图片', () => {
  /** 图片优先走名片里的 OSS 地址：原件可能很大，没必要为了预览下一遍 */
  it('名片里有 OSS 地址就直接用它预览', async () => {
    readProjectFileApi.mockResolvedValue({
      code: 0,
      data: {
        path: 'media/cover.png.md',
        content: '---\noss: https://oss.example.com/cover.png\nwidth: 1080\n---\n',
        size: 80,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    })
    renderPanel(node('media/cover.png'))

    const image = await screen.findByAltText('cover.png')
    expect(image).toHaveAttribute('src', 'https://oss.example.com/cover.png')
    expect(downloadProjectFileApi).not.toHaveBeenCalled()
    expect(screen.getByText('materials.preview.cardOss')).toBeInTheDocument()
  })

  it('没有名片就退回去下载原件预览', async () => {
    readProjectFileApi.mockResolvedValue({ code: 20100 })
    downloadProjectFileApi.mockResolvedValue(new Blob(['png']))
    renderPanel(node('media/cover.png'))

    const image = await screen.findByAltText('cover.png')
    expect(image).toHaveAttribute('src', 'blob:preview')
    // 两个候选名片路径都试过了才去下原件
    expect(readProjectFileApi).toHaveBeenCalledWith('p1', 'media/cover.png.md')
    expect(readProjectFileApi).toHaveBeenCalledWith('p1', 'media/cover.md')
    expect(screen.getByText('materials.preview.cardMissing')).toBeInTheDocument()
  })

  it('原件也下不下来时给二进制那套说明', async () => {
    readProjectFileApi.mockResolvedValue({ code: 20100 })
    downloadProjectFileApi.mockRejectedValue(new Error('offline'))
    renderPanel(node('media/cover.png'))

    expect(await screen.findByText('materials.preview.imageFailed')).toBeInTheDocument()
  })
})
