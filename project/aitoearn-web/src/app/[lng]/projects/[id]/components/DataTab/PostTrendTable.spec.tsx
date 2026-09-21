import type { PostMetricTrend } from '@/api/creator-notes/creator-notes.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPostMetricSeriesApi = vi.fn()

vi.mock('@/api/creator-notes/creator-notes.api', () => ({
  getPostMetricSeriesApi: (...a: unknown[]) => getPostMetricSeriesApi(...a),
}))

const { PostTrendTable } = await import('./PostTrendTable')

const METRICS = { views: 1000, comments: 2, likes: 30, collects: 4, shares: 5 }

function trend(overrides: Partial<PostMetricTrend> = {}): PostMetricTrend {
  return {
    publishedPostId: 'post-1',
    title: '待产包清单',
    publishedAt: '2026-09-20T00:00:00.000Z',
    latest: METRICS,
    delta: { views: 120, comments: 0, likes: -3, collects: 0, shares: 0 },
    latestCollectedAt: '2026-09-21T08:00:00.000Z',
    snapshotCount: 3,
    ...overrides,
  }
}

function point(collectedAt: string, views: number) {
  return { collectedAt, metrics: { ...METRICS, views } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getPostMetricSeriesApi.mockResolvedValue({ code: 0, data: [] })
})

describe('postTrendTable 行', () => {
  it('标题为空时退回帖子 id，不显示成一片空白', () => {
    render(<PostTrendTable trends={[trend({ title: '' })]} />)
    expect(screen.getByText('post-1')).toBeInTheDocument()
  })

  it('变化量带正负号，没变化显示破折号', () => {
    render(<PostTrendTable trends={[trend()]} />)

    expect(screen.getByText('+120')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  /** 只采过一次的帖子没有对比值，写「首次」比写一排 +0 诚实 */
  it('只采过一次的帖子五个指标都写「首次」', () => {
    render(<PostTrendTable trends={[trend({ delta: undefined })]} />)
    expect(screen.getAllByText('首次')).toHaveLength(5)
  })

  /** 没登记过发布时间的老记录留空，不拿创建时间冒充 */
  it('没有发布时间时留破折号', () => {
    render(<PostTrendTable trends={[trend({ publishedAt: undefined, delta: undefined })]} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

/**
 * 折线是按需拉的：一个项目几十条帖子，进页面就把每条的完整序列都拉回来，
 * 换来的只是一屏根本看不过来的小图。
 */
describe('postTrendTable 时间序列', () => {
  it('不展开就不拉序列', () => {
    render(<PostTrendTable trends={[trend()]} />)
    expect(getPostMetricSeriesApi).not.toHaveBeenCalled()
  })

  it('展开时拉一次，画出五条折线', async () => {
    getPostMetricSeriesApi.mockResolvedValue({
      code: 0,
      data: [point('2026-09-20T08:00:00.000Z', 100), point('2026-09-21T08:00:00.000Z', 1000)],
    })
    render(<PostTrendTable trends={[trend()]} />)

    await userEvent.click(screen.getByRole('button', { name: '展开时间序列' }))

    await waitFor(() => expect(getPostMetricSeriesApi).toHaveBeenCalledWith('post-1'))
    expect(await screen.findByRole('img', { name: '浏览走势' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(5)
    // 每条折线上标着这条序列有几个点
    expect(screen.getAllByText(/2 个点/)).toHaveLength(5)
  })

  it('收起再展开不会重复拉', async () => {
    getPostMetricSeriesApi.mockResolvedValue({ code: 0, data: [point('2026-09-21T08:00:00.000Z', 100)] })
    render(<PostTrendTable trends={[trend()]} />)

    await userEvent.click(screen.getByRole('button', { name: '展开时间序列' }))
    await screen.findByRole('img', { name: '浏览走势' })
    await userEvent.click(screen.getByRole('button', { name: '收起时间序列' }))
    await userEvent.click(screen.getByRole('button', { name: '展开时间序列' }))

    await waitFor(() => expect(screen.getByRole('img', { name: '浏览走势' })).toBeInTheDocument())
    expect(getPostMetricSeriesApi).toHaveBeenCalledTimes(1)
  })

  it('还没有快照时说清楚该干什么', async () => {
    render(<PostTrendTable trends={[trend()]} />)

    await userEvent.click(screen.getByRole('button', { name: '展开时间序列' }))

    expect(await screen.findByText('还没有快照。采集一次之后这里就会有点。')).toBeInTheDocument()
  })

  it('拉序列失败时也落到空状态，不把整张表搞崩', async () => {
    getPostMetricSeriesApi.mockRejectedValue(new Error('network'))
    render(<PostTrendTable trends={[trend()]} />)

    await userEvent.click(screen.getByRole('button', { name: '展开时间序列' }))

    expect(await screen.findByText('还没有快照。采集一次之后这里就会有点。')).toBeInTheDocument()
  })

  it('业务错误时同样落到空状态', async () => {
    getPostMetricSeriesApi.mockResolvedValue({ code: 20705, data: null })
    render(<PostTrendTable trends={[trend()]} />)

    await userEvent.click(screen.getByRole('button', { name: '展开时间序列' }))

    expect(await screen.findByText('还没有快照。采集一次之后这里就会有点。')).toBeInTheDocument()
  })

  /** 同时展开两条会把两条序列混在一起，一次只能开一条 */
  it('展开另一条时把前一条收起来', async () => {
    getPostMetricSeriesApi.mockResolvedValue({ code: 0, data: [point('2026-09-21T08:00:00.000Z', 100)] })
    render(<PostTrendTable trends={[trend(), trend({ publishedPostId: 'post-2', title: '第二条' })]} />)

    const [first, second] = screen.getAllByRole('button', { name: '展开时间序列' })
    await userEvent.click(first)
    await screen.findByRole('img', { name: '浏览走势' })

    await userEvent.click(second)

    await waitFor(() => expect(getPostMetricSeriesApi).toHaveBeenCalledWith('post-2'))
    expect(screen.getAllByRole('button', { name: '收起时间序列' })).toHaveLength(1)
  })
})
