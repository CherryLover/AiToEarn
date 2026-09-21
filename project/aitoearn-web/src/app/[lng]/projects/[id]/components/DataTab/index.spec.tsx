import type { Angle } from '@/api/angles/angle.types'
import type { CreatorNoteRow } from '@/api/creator-notes/creator-notes.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AngleSource, AngleStatus } from '@/api/angles/angle.types'
import { MatchState } from '@/api/creator-notes/creator-notes.types'

const getAngleListApi = vi.fn()
const getPublishedPostListApi = vi.fn()
const createSyncTaskApi = vi.fn()
const getProjectAngleTotalsApi = vi.fn()
const getProjectMetricTrendsApi = vi.fn()
const getCreatorNoteRowListApi = vi.fn()
const claimCreatorNoteRowApi = vi.fn()
const adoptCreatorNoteRowApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/angles/angle.api', () => ({ getAngleListApi: (...a: unknown[]) => getAngleListApi(...a) }))
vi.mock('@/api/publishing/publishing.api', () => ({ getPublishedPostListApi: (...a: unknown[]) => getPublishedPostListApi(...a) }))
vi.mock('@/api/creator-notes/creator-notes.api', () => ({
  adoptCreatorNoteRowApi: (...a: unknown[]) => adoptCreatorNoteRowApi(...a),
  claimCreatorNoteRowApi: (...a: unknown[]) => claimCreatorNoteRowApi(...a),
  createSyncTaskApi: (...a: unknown[]) => createSyncTaskApi(...a),
  getCreatorNoteRowListApi: (...a: unknown[]) => getCreatorNoteRowListApi(...a),
  getProjectAngleTotalsApi: (...a: unknown[]) => getProjectAngleTotalsApi(...a),
  getProjectMetricTrendsApi: (...a: unknown[]) => getProjectMetricTrendsApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))

const { DataTab } = await import('./index')

const METRICS = { views: 1000, comments: 2, likes: 30, collects: 4, shares: 5 }

function row(overrides: Partial<CreatorNoteRow> & { id: string, title: string }): CreatorNoteRow {
  return {
    platform: 'xhs',
    accountId: 'acc-1',
    publishedAtText: '09-20',
    publishedAt: '2026-09-20T00:00:00.000Z',
    collectedAt: '2026-09-21T08:00:00.000Z',
    metrics: METRICS,
    matchState: MatchState.Unmatched,
    matchCandidates: [],
    titleTruncated: false,
    ...overrides,
  } as CreatorNoteRow
}

function angle(id: string, name: string): Angle {
  return {
    id,
    projectId: 'p1',
    slug: id,
    name,
    desc: null,
    source: AngleSource.User,
    parentAngleId: null,
    status: AngleStatus.Candidate,
    sourceAssetPaths: null,
    promptSnapshot: null,
    createdAt: '',
    updatedAt: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getAngleListApi.mockResolvedValue({ code: 0, data: [angle('a1', '孕晚期焦虑')] })
  getPublishedPostListApi.mockResolvedValue({ code: 0, data: { list: [{ id: 'post-1', title: '待产包清单' }], total: 1 } })
  getProjectAngleTotalsApi.mockResolvedValue({ code: 0, data: [] })
  getProjectMetricTrendsApi.mockResolvedValue({ code: 0, data: [] })
  getCreatorNoteRowListApi.mockResolvedValue({ code: 0, data: { list: [], total: 0 } })
})

/** 未归属那一块的两个接口（unmatched + ambiguous）给同一份数据 */
function unmatchedRows(rows: CreatorNoteRow[]) {
  getCreatorNoteRowListApi.mockImplementation(async (params: { matchState: string }) =>
    params.matchState === MatchState.Unmatched
      ? { code: 0, data: { list: rows, total: rows.length } }
      : { code: 0, data: { list: [], total: 0 } })
}

async function renderTab(readOnly = false) {
  const view = render(<DataTab projectId="p1" readOnly={readOnly} />)
  await waitFor(() => expect(screen.getByText('按方向汇总')).toBeInTheDocument())
  return view
}

describe('dataTab 空状态', () => {
  it('没有数据时三块都给出该干什么的提示', async () => {
    await renderTab()

    expect(screen.getByText(/还没有归属到这个项目的数据/)).toBeInTheDocument()
    expect(screen.getByText('这个窗口里还没有快照。')).toBeInTheDocument()
  })

  it('加载失败时明说一句', async () => {
    getProjectMetricTrendsApi.mockResolvedValue({ code: 20705, data: null })
    await renderTab()

    expect(screen.getByText('数据加载失败，刷新一下再试。')).toBeInTheDocument()
  })
})

describe('dataTab 数据展示', () => {
  it('按方向汇总用方向名字，不是 id', async () => {
    getProjectAngleTotalsApi.mockResolvedValue({
      code: 0,
      data: [{ angleId: 'a1', postCount: 2, totals: METRICS }],
    })

    await renderTab()

    expect(screen.getByText('孕晚期焦虑')).toBeInTheDocument()
  })

  it('每条帖子按标题和发布时间列出来', async () => {
    getProjectMetricTrendsApi.mockResolvedValue({
      code: 0,
      data: [{
        publishedPostId: 'post-1',
        title: '待产包清单',
        publishedAt: '2026-09-20T00:00:00.000Z',
        latestCollectedAt: '2026-09-21T08:00:00.000Z',
        latest: METRICS,
        delta: METRICS,
        snapshotCount: 2,
      }],
    })

    await renderTab()

    expect(screen.getByText('待产包清单')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
  })
})

/**
 * 未归属那一块默认收起来：账号里几十条帖子只有几条属于这个项目，
 * 摊开之后真正要看的「按方向汇总」和「每条帖子」会被挤到屏幕外面去。
 */
describe('dataTab 未归属那一块', () => {
  it('默认收起，只显示条数', async () => {
    unmatchedRows([row({ id: 'r1', title: '没归属的帖子' })])
    await renderTab()

    await waitFor(() => expect(screen.getByText('共 1 条')).toBeInTheDocument())
    expect(screen.queryByText('没归属的帖子')).not.toBeInTheDocument()
  })

  it('点一下展开，再点一下收回去', async () => {
    unmatchedRows([row({ id: 'r1', title: '没归属的帖子' })])
    await renderTab()
    const toggle = screen.getByRole('button', { name: /未归属的帖子/ })

    await userEvent.click(toggle)
    expect(await screen.findByText('没归属的帖子')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle)
    await waitFor(() => expect(screen.queryByText('没归属的帖子')).not.toBeInTheDocument())
  })

  it('展开后没有待处理的帖子时说清楚', async () => {
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: /未归属的帖子/ }))

    expect(await screen.findByText('没有待处理的帖子。')).toBeInTheDocument()
  })

  /** 标题被平台截断、前缀撞上多条，都是「系统不敢猜」，得让人看见原因 */
  it('把系统没猜的原因标出来', async () => {
    unmatchedRows([
      row({ id: 'r1', title: '被截断的标题', titleTruncated: true }),
      row({ id: 'r2', title: '撞上多条的', matchState: MatchState.Ambiguous, matchCandidates: ['x', 'y'] }),
    ])
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: /未归属的帖子/ }))

    expect(await screen.findByText('标题被平台截断')).toBeInTheDocument()
    expect(screen.getByText('前缀撞上 2 条，系统没猜')).toBeInTheDocument()
  })

  it('没选发布记录就点认领会被拦下来', async () => {
    unmatchedRows([row({ id: 'r1', title: '没归属的帖子' })])
    await renderTab()
    await userEvent.click(screen.getByRole('button', { name: /未归属的帖子/ }))

    await userEvent.click(await screen.findByRole('button', { name: '认领' }))

    expect(toastError).toHaveBeenCalledWith('先选一条要认领到的发布记录')
    expect(claimCreatorNoteRowApi).not.toHaveBeenCalled()
  })

  it('建成新记录：确认之后调接口，成功了关掉对话框', async () => {
    unmatchedRows([row({ id: 'r1', title: '自己做的内容' })])
    adoptCreatorNoteRowApi.mockResolvedValue({ code: 0, data: {} })
    await renderTab()
    await userEvent.click(screen.getByRole('button', { name: /未归属的帖子/ }))

    await userEvent.click(await screen.findByRole('button', { name: '建成新记录' }))
    expect(await screen.findByText('建成这个项目的一条发布记录')).toBeInTheDocument()
    // 平台列表页上没有正文，这一点必须在对话框里说清楚
    expect(screen.getByText(/没有正文，所以建出来的记录正文是空的/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '建记录' }))

    await waitFor(() => expect(adoptCreatorNoteRowApi).toHaveBeenCalledWith('r1', { angleId: undefined, projectId: 'p1' }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('建记录失败时对话框留着，让人能重试', async () => {
    unmatchedRows([row({ id: 'r1', title: '自己做的内容' })])
    adoptCreatorNoteRowApi.mockResolvedValue({ code: 20713, data: null })
    await renderTab()
    await userEvent.click(screen.getByRole('button', { name: /未归属的帖子/ }))
    await userEvent.click(await screen.findByRole('button', { name: '建成新记录' }))

    await userEvent.click(await screen.findByRole('button', { name: '建记录' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('建记录失败，刷新一下再试'))
    expect(screen.getByText('建成这个项目的一条发布记录')).toBeInTheDocument()
  })

  it('取消关掉对话框，不调接口', async () => {
    unmatchedRows([row({ id: 'r1', title: '自己做的内容' })])
    await renderTab()
    await userEvent.click(screen.getByRole('button', { name: /未归属的帖子/ }))
    await userEvent.click(await screen.findByRole('button', { name: '建成新记录' }))

    await userEvent.click(await screen.findByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByText('建成这个项目的一条发布记录')).not.toBeInTheDocument())
    expect(adoptCreatorNoteRowApi).not.toHaveBeenCalled()
  })
})

describe('dataTab 立刻采一次', () => {
  it('派单成功说一声', async () => {
    createSyncTaskApi.mockResolvedValue({ code: 0, data: {} })
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: '立刻采一次' }))

    await waitFor(() => expect(createSyncTaskApi).toHaveBeenCalledWith({ platform: expect.any(String), projectId: 'p1' }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  /** 最常见的两种失败：名下没有声明了这个平台的机器，或者插件版本还不会干这活 */
  it('派单失败时把服务端的话原样显示出来', async () => {
    createSyncTaskApi.mockResolvedValue({ code: 20604, message: '没有能干这活的设备' })
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: '立刻采一次' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('没有能干这活的设备'))
  })

  it('请求挂掉时给一句兜底的话', async () => {
    createSyncTaskApi.mockRejectedValue(new Error('network'))
    await renderTab()

    await userEvent.click(screen.getByRole('button', { name: '立刻采一次' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('建采集工单失败'))
  })

  /** 归档项目只读：不能再派单，但数据还得看得见 */
  it('归档项目里没有「立刻采一次」', async () => {
    await renderTab(true)

    expect(screen.queryByRole('button', { name: '立刻采一次' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /刷新/ })).toBeInTheDocument()
  })
})

describe('dataTab 刷新', () => {
  it('点刷新会把趋势和未归属都重拉一遍', async () => {
    await renderTab()
    getProjectMetricTrendsApi.mockClear()
    getCreatorNoteRowListApi.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /刷新/ }))

    await waitFor(() => expect(getProjectMetricTrendsApi).toHaveBeenCalledTimes(1))
    expect(getCreatorNoteRowListApi).toHaveBeenCalledTimes(2)
  })
})
