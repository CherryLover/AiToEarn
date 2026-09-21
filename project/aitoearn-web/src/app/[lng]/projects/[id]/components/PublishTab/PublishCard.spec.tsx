import type { PublishedPostDetail } from '@/api/publishing/publishing.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkStatus, PublishedPostSource, PublishStatus } from '@/api/publishing/publishing.types'

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
  deletePublishedPostApi: (...a: unknown[]) => deletePublishedPostApi(...a),
  failPublishedPostApi: (...a: unknown[]) => failPublishedPostApi(...a),
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

const { PublishCard } = await import('./PublishCard')

function post(overrides: Partial<PublishedPostDetail> = {}): PublishedPostDetail {
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
    snapshot: { title: '孕晚期焦虑', body: '正文正文', topics: ['孕晚期', '待产包'], mediaUrls: [] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectFileTreeApi.mockResolvedValue({ code: 0, data: null })
})

function renderCard(detail = post(), options: { readOnly?: boolean, draftNotes?: Parameters<typeof PublishCard>[0]['draftNotes'] } = {}) {
  const onUpdated = vi.fn()
  const onDeleted = vi.fn()
  const view = render(
    <PublishCard
      projectId="p1"
      post={detail}
      draftNotes={options.draftNotes ?? null}
      readOnly={options.readOnly ?? false}
      onUpdated={onUpdated}
      onDeleted={onDeleted}
    />,
  )
  return { onUpdated, onDeleted, ...view }
}

describe('publishCard 内容打包', () => {
  it('标题、正文、话题都摆出来，并且明说发是人自己去发', () => {
    renderCard()

    expect(screen.getAllByText('孕晚期焦虑').length).toBeGreaterThan(0)
    expect(screen.getByText('正文正文')).toBeInTheDocument()
    expect(screen.getByText('#孕晚期')).toBeInTheDocument()
    expect(screen.getByText('publish.card.manualTip')).toBeInTheDocument()
  })

  it('正文长了才给折叠，短的不给', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: /publish.card.expand/ })).not.toBeInTheDocument()

    renderCard(post({ snapshot: { title: 't', body: '长'.repeat(400), topics: [], mediaUrls: [] } }))
    expect(screen.getByRole('button', { name: /publish.card.expand/ })).toBeInTheDocument()
  })

  it('一张图都没有时说清楚是草稿没写还是没打包进来', () => {
    renderCard(post(), { draftNotes: { postId: 'post-1', mediaDeclared: false, bodyFallback: false, skippedMedia: [] } })

    expect(screen.getByText('publish.card.mediaUndeclared')).toBeInTheDocument()
    expect(screen.getByText('publish.card.mediaUndeclaredHint')).toBeInTheDocument()
  })

  /** 草稿没写 `## 正文` 小节，正文是整篇原文兜出来的，发之前得人工删一刀 */
  it('正文是整篇原文兜出来的时候给出提醒', () => {
    renderCard(post(), { draftNotes: { postId: 'post-1', mediaDeclared: true, bodyFallback: true, skippedMedia: [] } })

    expect(screen.getByText('publish.card.bodyFallbackTitle')).toBeInTheDocument()
  })

  it('快照里有图时一张张列出来，多于一张才给整批下载', () => {
    renderCard(post({
      snapshot: { title: 't', body: 'b', topics: [], mediaUrls: ['https://oss/a.png', 'https://oss/b.png'] },
    }))

    expect(screen.getByAltText('a.png')).toBeInTheDocument()
    expect(screen.getByAltText('b.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish.card.downloadAll/ })).toBeInTheDocument()
  })

  it('平台有创作后台地址时给一个入口', () => {
    renderCard()

    const link = screen.getByRole('link', { name: /publish.card.openPlatform/ })
    expect(link).toHaveAttribute('href', 'https://creator.xiaohongshu.com/publish/publish')
  })
})

describe('publishCard 发完回来登记', () => {
  it('链接不合法时当场挡下来，不发请求', async () => {
    renderCard()

    await userEvent.type(screen.getByPlaceholderText('publish.card.urlPlaceholder'), '随便写的')
    await userEvent.click(screen.getByRole('button', { name: /publish.card.complete/ }))

    expect(await screen.findByText('publish.card.urlInvalid')).toBeInTheDocument()
    expect(completePublishedPostApi).not.toHaveBeenCalled()
  })

  it('一个字都没填时说要填链接', async () => {
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /publish.card.complete/ }))

    expect(await screen.findByText('publish.card.urlRequired')).toBeInTheDocument()
  })

  it('填好链接提交，成功后把最新记录交回上层', async () => {
    const updated = post({ publishStatus: PublishStatus.Published, linkStatus: LinkStatus.Claimed, postUrl: 'https://www.xiaohongshu.com/explore/1' })
    completePublishedPostApi.mockResolvedValue({ code: 0, data: updated })
    const { onUpdated } = renderCard()

    await userEvent.type(screen.getByPlaceholderText('publish.card.urlPlaceholder'), 'https://www.xiaohongshu.com/explore/1')
    await userEvent.type(screen.getByPlaceholderText('publish.card.postIdPlaceholder'), 'note-1')
    await userEvent.click(screen.getByRole('button', { name: /publish.card.complete/ }))

    await waitFor(() => expect(completePublishedPostApi).toHaveBeenCalledWith('p1', 'post-1', {
      postUrl: 'https://www.xiaohongshu.com/explore/1',
      platformPostId: 'note-1',
    }))
    expect(toastSuccess).toHaveBeenCalledWith('publish.card.completeSuccess')
    expect(onUpdated).toHaveBeenCalledWith(updated)
  })

  it('登记失败时把业务码翻成具体说法', async () => {
    completePublishedPostApi.mockResolvedValue({ code: 20509 })
    renderCard()

    await userEvent.type(screen.getByPlaceholderText('publish.card.urlPlaceholder'), 'https://a.com/1')
    await userEvent.click(screen.getByRole('button', { name: /publish.card.complete/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('publishError.urlInvalid'))
  })

  /** 已经发过的记录只给看链接，不再给第二次回填的入口 */
  it('已发布的记录不再给回填入口', () => {
    renderCard(post({
      publishStatus: PublishStatus.Published,
      linkStatus: LinkStatus.Claimed,
      postUrl: 'https://www.xiaohongshu.com/explore/1',
      publishedAt: '2026-09-02T00:00:00.000Z',
    }))

    expect(screen.queryByPlaceholderText('publish.card.urlPlaceholder')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://www.xiaohongshu.com/explore/1' })).toBeInTheDocument()
  })

  it('归档项目里回填和删除都不给', () => {
    renderCard(post(), { readOnly: true })

    expect(screen.getByRole('button', { name: /publish.card.complete/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /publish.card.delete$/ })).not.toBeInTheDocument()
  })
})

describe('publishCard 标失败和删除', () => {
  it('标失败要填原因，填了才让提交', async () => {
    const updated = post({ publishStatus: PublishStatus.Failed, failReason: '平台限流' })
    failPublishedPostApi.mockResolvedValue({ code: 0, data: updated })
    const { onUpdated } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: /publish.card.fail$/ }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: /publish.card.failSubmit/ })).toBeDisabled()

    await userEvent.type(screen.getByPlaceholderText('publish.card.failPlaceholder'), '平台限流')
    await userEvent.click(screen.getByRole('button', { name: /publish.card.failSubmit/ }))

    await waitFor(() => expect(failPublishedPostApi).toHaveBeenCalledWith('p1', 'post-1', { reason: '平台限流' }))
    expect(onUpdated).toHaveBeenCalledWith(updated)
    expect(dialog).toBeDefined()
  })

  it('上次标的失败原因留在卡片上好回看', () => {
    renderCard(post({ publishStatus: PublishStatus.Failed, failReason: '平台限流' }))

    expect(screen.getByText('publish.card.failReason')).toBeInTheDocument()
  })

  it('删之前先确认，确认之后才真的删', async () => {
    deletePublishedPostApi.mockResolvedValue({ code: 0, data: null })
    const { onDeleted } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: /publish.card.delete$/ }))
    expect(await screen.findByText('publish.card.deleteTitle')).toBeInTheDocument()
    expect(deletePublishedPostApi).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /publish.card.deleteConfirm/ }))

    await waitFor(() => expect(deletePublishedPostApi).toHaveBeenCalledWith('p1', 'post-1'))
    expect(toastSuccess).toHaveBeenCalledWith('publish.card.deleted')
    expect(onDeleted).toHaveBeenCalledWith('post-1')
  })

  it('删失败时把业务码翻成具体说法，卡片留着', async () => {
    deletePublishedPostApi.mockResolvedValue({ code: 20500 })
    const { onDeleted } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: /publish.card.delete$/ }))
    await userEvent.click(await screen.findByRole('button', { name: /publish.card.deleteConfirm/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('publishError.notFound'))
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
