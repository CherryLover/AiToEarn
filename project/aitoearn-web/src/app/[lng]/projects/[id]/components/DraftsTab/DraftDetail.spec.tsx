import type { DraftItem } from './drafts.utils'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { DraftDetail } = await import('./DraftDetail')

const DRAFT_BODY = '---\ntitle: 孕晚期焦虑\ntopics: [孕晚期, 待产包]\n---\n\n## 正文\n正文正文\n'

function draft(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    path: 'drafts/20260901-xhs-pain',
    name: '20260901-xhs-pain',
    contentPath: 'drafts/20260901-xhs-pain/content.md',
    metaPath: 'drafts/20260901-xhs-pain/meta.json',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const META_JSON = JSON.stringify({
  projectName: 'forty-weeks',
  angleSlug: 'pain-point',
  platform: 'xhs',
  sourceAssetPaths: ['background/product/spec.md'],
  promptSnapshot: '按 pain-point 写一条小红书',
  model: 'claude-opus-5',
  createdAt: '2026-09-01T00:00:00.000Z',
  reviewer: '产品自己',
})

/** 按读的是哪个文件分别给回内容，正文和血缘走的是同一个读接口 */
function mockFiles(files: Record<string, string>) {
  readProjectFileApi.mockImplementation(async (_projectId: string, path: string) => {
    const content = files[path]
    if (content === undefined)
      return { code: 20100 }
    return { code: 0, data: { path, content, size: content.length, updatedAt: '2026-09-01T00:00:00.000Z' } }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('URL', Object.assign(globalThis.URL, {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  }))
  mockFiles({
    'drafts/20260901-xhs-pain/content.md': DRAFT_BODY,
    'drafts/20260901-xhs-pain/meta.json': META_JSON,
  })
})

function renderDetail(item = draft(), readOnly = false) {
  const onSaved = vi.fn()
  const onGoPublish = vi.fn()
  const view = render(
    <DraftDetail
      projectId="p1"
      draft={item}
      readOnly={readOnly}
      onSaved={onSaved}
      onGoPublish={onGoPublish}
    />,
  )
  return { onSaved, onGoPublish, ...view }
}

describe('draftDetail 拿这条去发布', () => {
  /** 草稿写完下一步就是发。不给这个入口，人得切到「发布」页把刚看的这条再选一遍 */
  it('点一下把这条草稿交出去', async () => {
    const { onGoPublish } = renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: /drafts.detail.goPublish/ }))

    expect(onGoPublish).toHaveBeenCalledTimes(1)
    expect(onGoPublish.mock.calls[0][0]).toMatchObject({ path: draft().path })
  })

  it('归档项目里不给这个入口', async () => {
    renderDetail(draft(), true)

    // 刷新按钮只读时也在，拿它确认这张卡已经渲染出来了
    expect(await screen.findByRole('button', { name: /action.refresh/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drafts.detail.goPublish/ })).not.toBeInTheDocument()
  })
})

describe('draftDetail 正文', () => {
  it('把标题、话题和正文读出来', async () => {
    renderDetail()

    // 头上一处、正文卡片里一处
    expect(await screen.findAllByText('孕晚期焦虑')).toHaveLength(2)
    expect(screen.getByText('#孕晚期')).toBeInTheDocument()
    expect(screen.getByDisplayValue(/正文正文/)).toBeInTheDocument()
  })

  it('没改之前存不了，改完能存并通知上层刷新', async () => {
    writeProjectFileApi.mockResolvedValue({ code: 0, data: null })
    const { onSaved } = renderDetail()

    const editor = await screen.findByDisplayValue(/正文正文/)
    expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled()

    await userEvent.type(editor, '补一句')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(writeProjectFileApi).toHaveBeenCalledWith('p1', {
      path: 'drafts/20260901-xhs-pain/content.md',
      content: `${DRAFT_BODY}补一句`,
    }))
    expect(toastSuccess).toHaveBeenCalledWith('drafts.detail.saveSuccess')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('存失败时把业务码翻成具体说法', async () => {
    writeProjectFileApi.mockResolvedValue({ code: 20105 })
    const { onSaved } = renderDetail()

    await userEvent.type(await screen.findByDisplayValue(/正文正文/), '!')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('fileError.writeFailed'))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('请求本身没通时说网络', async () => {
    writeProjectFileApi.mockRejectedValue(new Error('offline'))
    renderDetail()

    await userEvent.type(await screen.findByDisplayValue(/正文正文/), '!')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.network'))
  })

  /** 草稿目录里没有 content.md，读都不用读 */
  it('没有正文文件时直接说清楚，不去打读接口', async () => {
    renderDetail(draft({ contentPath: '', metaPath: '' }))

    expect(await screen.findByText('drafts.detail.noContent')).toBeInTheDocument()
    expect(readProjectFileApi).not.toHaveBeenCalled()
  })

  it('正文读不回来时把业务码显示出来', async () => {
    mockFiles({})
    renderDetail()

    expect(await screen.findByText('fileError.notFound')).toBeInTheDocument()
  })

  it('归档项目里没有保存按钮', async () => {
    renderDetail(draft(), true)

    await screen.findByDisplayValue(/正文正文/)
    expect(screen.queryByRole('button', { name: /detail.save/ })).not.toBeInTheDocument()
  })
})

describe('draftDetail 配图', () => {
  it('外链图片直接显示，不去读物料', async () => {
    mockFiles({
      'drafts/20260901-xhs-pain/content.md': `${DRAFT_BODY}\n![](https://oss.example.com/a.png)\n`,
      'drafts/20260901-xhs-pain/meta.json': META_JSON,
    })
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.media/ }))

    const image = await screen.findByAltText('https://oss.example.com/a.png')
    expect(image).toHaveAttribute('src', 'https://oss.example.com/a.png')
    expect(downloadProjectFileApi).not.toHaveBeenCalled()
  })

  /** 项目里的图先找名片里的 OSS 地址，省得为了预览把原件下一遍 */
  it('项目里的图优先用名片里的 OSS 地址', async () => {
    mockFiles({
      'drafts/20260901-xhs-pain/content.md': `${DRAFT_BODY}\n![](media/cover.png)\n`,
      'drafts/20260901-xhs-pain/meta.json': META_JSON,
      'media/cover.png.md': '---\noss: https://oss.example.com/cover.png\n---\n',
    })
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.media/ }))

    expect(await screen.findByAltText('media/cover.png')).toHaveAttribute('src', 'https://oss.example.com/cover.png')
    expect(downloadProjectFileApi).not.toHaveBeenCalled()
  })

  it('没有名片就退回去下载原件预览', async () => {
    mockFiles({
      'drafts/20260901-xhs-pain/content.md': `${DRAFT_BODY}\n![](media/cover.png)\n`,
      'drafts/20260901-xhs-pain/meta.json': META_JSON,
    })
    downloadProjectFileApi.mockResolvedValue(new Blob(['png']))
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.media/ }))

    expect(await screen.findByAltText('media/cover.png')).toHaveAttribute('src', 'blob:preview')
  })

  it('原件也下不下来时把这张单独标出来', async () => {
    mockFiles({
      'drafts/20260901-xhs-pain/content.md': `${DRAFT_BODY}\n![](media/cover.png)\n`,
      'drafts/20260901-xhs-pain/meta.json': META_JSON,
    })
    downloadProjectFileApi.mockRejectedValue(new Error('offline'))
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.media/ }))

    expect(await screen.findByText('drafts.detail.mediaFailed')).toBeInTheDocument()
    expect(screen.getByText('media/cover.png')).toBeInTheDocument()
  })

  it('一张配图都没有时给出说明', async () => {
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.media/ }))

    expect(await screen.findByText('drafts.detail.noMedia')).toBeInTheDocument()
  })
})

describe('draftDetail 血缘', () => {
  it('回答「这条是怎么来的」：方向、平台、物料、提示词、模型', async () => {
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.lineage/ }))

    expect(await screen.findByText('pain-point')).toBeInTheDocument()
    expect(screen.getByText('xhs')).toBeInTheDocument()
    expect(screen.getByText('background/product/spec.md')).toBeInTheDocument()
    expect(screen.getByText('按 pain-point 写一条小红书')).toBeInTheDocument()
    expect(screen.getByText('claude-opus-5')).toBeInTheDocument()
  })

  /** 认不出来的字段原样留着，别悄悄丢掉 */
  it('血缘里多出来的字段照原样列出来', async () => {
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.lineage/ }))

    expect(await screen.findByText('reviewer')).toBeInTheDocument()
    expect(screen.getByText('产品自己')).toBeInTheDocument()
  })

  it('没有血缘文件时说一声', async () => {
    mockFiles({ 'drafts/20260901-xhs-pain/content.md': DRAFT_BODY })
    renderDetail()

    await userEvent.click(await screen.findByRole('tab', { name: /drafts.detail.lineage/ }))

    expect(await screen.findByText('drafts.lineage.missing')).toBeInTheDocument()
  })
})
