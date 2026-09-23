import type { PublishedPostDetail, PublishedPostListItem } from '@/api/publishing/publishing.types'
import { chooseOption } from '@test/radix'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkStatus, PublishedPostSource, PublishStatus } from '@/api/publishing/publishing.types'

const createPublishFromDraftApi = vi.fn()
const getPublishedPostDetailApi = vi.fn()
const getPublishedPostListApi = vi.fn()
const completePublishedPostApi = vi.fn()
const deletePublishedPostApi = vi.fn()
const failPublishedPostApi = vi.fn()
const getProjectFileTreeApi = vi.fn()
const readProjectFileApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()

vi.mock('@/api/publishing/publishing.api', () => ({
  completePublishedPostApi: (...a: unknown[]) => completePublishedPostApi(...a),
  createPublishFromDraftApi: (...a: unknown[]) => createPublishFromDraftApi(...a),
  deletePublishedPostApi: (...a: unknown[]) => deletePublishedPostApi(...a),
  failPublishedPostApi: (...a: unknown[]) => failPublishedPostApi(...a),
  getPublishedPostDetailApi: (...a: unknown[]) => getPublishedPostDetailApi(...a),
  getPublishedPostListApi: (...a: unknown[]) => getPublishedPostListApi(...a),
}))
vi.mock('@/api/projects/project-file.api', () => ({
  getProjectFileTreeApi: (...a: unknown[]) => getProjectFileTreeApi(...a),
  readProjectFileApi: (...a: unknown[]) => readProjectFileApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))
/** 草稿列表是发布页的入参来源，这里只管有没有草稿，读盘那套在草稿页自己的用例里测 */
vi.mock('../DraftsTab/useDrafts', () => ({
  useDrafts: () => ({
    drafts: [
      { path: 'drafts/20260901-xhs-pain', name: '20260901-xhs-pain', platform: 'xhs', title: '孕晚期焦虑' },
      { path: 'drafts/20260902-douyin-bag', name: '20260902-douyin-bag', platform: 'douyin', title: '待产包' },
    ],
    isLoading: false,
  }),
}))

const { PublishTab } = await import('./index')

function listItem(overrides: Partial<PublishedPostListItem> = {}): PublishedPostListItem {
  return {
    id: 'post-1',
    projectId: 'p1',
    angleId: null,
    draftPath: 'drafts/20260901-xhs-pain',
    platform: 'xhs',
    accountId: null,
    executionTaskId: null,
    publishStatus: PublishStatus.Pending,
    linkStatus: LinkStatus.None,
    source: PublishedPostSource.Registered,
    platformPostId: null,
    postUrl: null,
    publishedAt: null,
    failReason: null,
    title: '孕晚期焦虑',
    mediaCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function detail(overrides: Partial<PublishedPostDetail> = {}): PublishedPostDetail {
  return {
    ...listItem(overrides),
    snapshot: { title: '孕晚期焦虑', body: '正文正文', topics: ['孕晚期'], mediaUrls: [] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getPublishedPostListApi.mockResolvedValue({ code: 0, data: { list: [listItem()], total: 1, page: 1, pageSize: 20, totalPages: 1 } })
  getPublishedPostDetailApi.mockResolvedValue({ code: 0, data: detail() })
  getProjectFileTreeApi.mockResolvedValue({ code: 0, data: null })
})

async function renderTab(readOnly = false) {
  const view = render(<PublishTab projectId="p1" readOnly={readOnly} presetDraft={null} />)
  await waitFor(() => expect(getPublishedPostListApi).toHaveBeenCalled())
  return view
}

describe('publishTab 记录列表', () => {
  it('把已登记的记录摆出来，发布状态和链接状态分两列', async () => {
    await renderTab()

    expect(await screen.findByText('孕晚期焦虑')).toBeInTheDocument()
    expect(screen.getByText(`publish.publishStatus.${PublishStatus.Pending}`)).toBeInTheDocument()
    expect(screen.getByText(`publish.linkStatus.${LinkStatus.None}`)).toBeInTheDocument()
    expect(screen.getByText('publish.records.notPublishedYet')).toBeInTheDocument()
  })

  it('一条都没有时说清楚这一步要人自己去发', async () => {
    getPublishedPostListApi.mockResolvedValue({ code: 0, data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0 } })
    await renderTab()

    expect(await screen.findByText('publish.empty.title')).toBeInTheDocument()
    expect(screen.getByText('publish.empty.notAuto')).toBeInTheDocument()
  })

  it('拉列表失败时给重试按钮', async () => {
    getPublishedPostListApi.mockResolvedValue({ code: 20500, data: null })
    await renderTab()

    expect(await screen.findByText('publish.records.loadFailed')).toBeInTheDocument()
    getPublishedPostListApi.mockResolvedValue({ code: 0, data: { list: [listItem()], total: 1, page: 1, pageSize: 20, totalPages: 1 } })

    await userEvent.click(screen.getByRole('button', { name: /action.retry/ }))

    expect(await screen.findByText('孕晚期焦虑')).toBeInTheDocument()
  })

  it('点一行就拉那条的完整快照', async () => {
    await renderTab()

    await userEvent.click(await screen.findByText('孕晚期焦虑'))

    await waitFor(() => expect(getPublishedPostDetailApi).toHaveBeenCalledWith('p1', 'post-1'))
    expect(await screen.findByText('正文正文')).toBeInTheDocument()
  })

  it('拉详情失败时把业务码翻成具体说法', async () => {
    getPublishedPostDetailApi.mockResolvedValue({ code: 20500 })
    await renderTab()

    await userEvent.click(await screen.findByText('孕晚期焦虑'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('publishError.notFound'))
  })
})

describe('publishTab 从「生成」页带过来的草稿', () => {
  async function renderWithPreset(presetPath: string) {
    const view = render(
      <PublishTab
        projectId="p1"
        readOnly={false}
        presetDraft={{ path: presetPath, at: 1 }}
      />,
    )
    await waitFor(() => expect(getPublishedPostListApi).toHaveBeenCalled())
    return view
  }

  /**
   * 带过来的草稿要直接选上——不然人刚在「生成」页看着这条，切过来还得在下拉里再找一遍。
   *
   * 这里专门盯一个先后顺序：切过来那一瞬间面板刚挂载、草稿列表还在路上，
   * 选上之后会被「选中的草稿没了就清空」那条检查当场冲掉。修过一次，别再改回去。
   */
  it('草稿列表到齐之后把带过来的那条选上', async () => {
    await renderWithPreset('drafts/20260902-douyin-bag')

    await waitFor(() => {
      expect(screen.getByLabelText(/publish.prepare.draftLabel/)).toHaveTextContent('20260902-douyin-bag')
    })
    expect(screen.getByRole('button', { name: /publish.prepare.submit/ })).toBeEnabled()
  })

  /** 带过来一条根本不存在的，不能把下拉卡在一个选不中的值上 */
  it('带过来的草稿不存在就当没带', async () => {
    await renderWithPreset('drafts/not-here')

    // 下拉还停在占位文案上，说明那条没被选中
    expect(screen.getByLabelText(/publish.prepare.draftLabel/))
      .toHaveTextContent(/publish.prepare.draftPlaceholder/)
    expect(screen.getByRole('button', { name: /publish.prepare.submit/ })).toBeDisabled()
  })
})

describe('publishTab 打包一条待发内容', () => {
  it('选草稿时顺手把平台也选上，建出来之后卡片直接展开', async () => {
    createPublishFromDraftApi.mockResolvedValue({
      code: 0,
      data: { post: detail(), skippedMedia: [], mediaDeclared: true, bodyFallback: false },
    })
    await renderTab()

    await chooseOption(screen.getByLabelText(/publish.prepare.draftLabel/), '20260902-douyin-bag')
    await userEvent.click(screen.getByRole('button', { name: /publish.prepare.submit/ }))

    await waitFor(() => expect(createPublishFromDraftApi).toHaveBeenCalledWith('p1', {
      draftPath: 'drafts/20260902-douyin-bag',
      platform: 'douyin',
      mode: 'manual',
    }))
    expect(toastSuccess).toHaveBeenCalledWith('publish.prepare.created')
    // 刚建出来的那条已经在手上，不用再拉一次详情
    expect(getPublishedPostDetailApi).not.toHaveBeenCalled()
    expect(await screen.findByText('正文正文')).toBeInTheDocument()
  })

  /** 有图没打包进来要按原因分开说：路径被拒跟 OSS 一点关系都没有 */
  it('有图没打包进来时按原因分开提示', async () => {
    createPublishFromDraftApi.mockResolvedValue({
      code: 0,
      data: {
        post: detail(),
        skippedMedia: [
          { path: 'media/a.png', reason: 'oss_missing' },
          { path: '../outside.png', reason: 'path_not_allowed' },
        ],
        mediaDeclared: true,
        bodyFallback: false,
      },
    })
    await renderTab()

    await chooseOption(screen.getByLabelText(/publish.prepare.draftLabel/), '20260901-xhs-pain')
    await userEvent.click(screen.getByRole('button', { name: /publish.prepare.submit/ }))

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('publish.skipped.title')).toBeInTheDocument()
    expect(screen.getByText(/media\/a.png/)).toBeInTheDocument()
    expect(screen.getByText(/outside.png/)).toBeInTheDocument()
  })

  it('打包失败时把业务码翻成具体说法', async () => {
    createPublishFromDraftApi.mockResolvedValue({ code: 20503 })
    await renderTab()

    await chooseOption(screen.getByLabelText(/publish.prepare.draftLabel/), '20260901-xhs-pain')
    await userEvent.click(screen.getByRole('button', { name: /publish.prepare.submit/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('publishError.draftNotFound'))
  })

  it('请求本身没通时说网络', async () => {
    createPublishFromDraftApi.mockRejectedValue(new Error('offline'))
    await renderTab()

    await chooseOption(screen.getByLabelText(/publish.prepare.draftLabel/), '20260901-xhs-pain')
    await userEvent.click(screen.getByRole('button', { name: /publish.prepare.submit/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.network'))
  })

  it('没选草稿之前打包按钮是灰的', async () => {
    await renderTab()

    expect(screen.getByRole('button', { name: /publish.prepare.submit/ })).toBeDisabled()
  })

  /** 归档项目只读：记录还能看，但不给再打包新的 */
  it('归档项目里打包按钮不可用', async () => {
    await renderTab(true)

    expect(screen.getByRole('button', { name: /publish.prepare.submit/ })).toBeDisabled()
  })
})
