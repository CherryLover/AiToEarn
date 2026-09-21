/**
 * 建采集工单、认领未归属的行、每 3 小时那一轮调度。
 */
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { CreatorNoteMatchState, ExecutionTaskType, PublishedPostPublishStatus, PublishedPostSource } from '@yikart/mongodb'
import { describe, expect, it, vi } from 'vitest'
import { findCollectProfile } from './collect-specs'
import { CreatorNotesScheduler } from './creator-notes.scheduler'
import { CreatorNotesService } from './creator-notes.service'

vi.mock('../../config', () => ({
  config: {
    projects: { root: '/tmp/aitoearn-test-projects' },
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

interface BuildOptions {
  devices?: { id: string, userId: string }[]
  projects?: { id: string, userId?: string, status?: string }[]
  angles?: { id: string, projectId: string }[]
  rows?: Record<string, unknown>[]
  posts?: Record<string, unknown>[]
  activeSyncTasks?: number
}

function build(options: BuildOptions = {}) {
  const rows = options.rows ?? []
  const metrics: Record<string, unknown>[] = []
  const created: Record<string, unknown>[] = []

  const rowRepository = {
    getByIdAndUserId: vi.fn(async (id: string) => rows.find(row => row.id === id) ?? null),
    updateAsMatchedById: vi.fn(async (id: string, _userId: string, publishedPostId: string) => {
      const row = rows.find(item => item.id === id)
      if (!row || row.matchState === CreatorNoteMatchState.MATCHED)
        return null

      row.matchState = CreatorNoteMatchState.MATCHED
      row.matchedPublishedPostId = publishedPostId
      row.matchCandidates = []
      return row
    }),
    listWithPagination: vi.fn(async () => ({ list: rows, total: rows.length })),
    countByUserIdAndMatchState: vi.fn(async () => rows.length),
  }

  const metricRepository = {
    createIfAbsent: vi.fn(async (data: Record<string, unknown>) => {
      metrics.push(data)
      return data
    }),
    listByPublishedPostId: vi.fn(async () => []),
    listTrendsByProjectId: vi.fn(async () => []),
    listAngleTotalsByProjectId: vi.fn(async () => []),
  }

  const createdPosts: Record<string, unknown>[] = []
  const publishedPostRepository = {
    getByIdAndUserId: vi.fn(async (id: string) =>
      (options.posts ?? []).find(post => post.id === id) ?? createdPosts.find(post => post.id === id) ?? null,
    ),
    listByIds: vi.fn(async () => options.posts ?? []),
    create: vi.fn(async (data: Record<string, unknown>) => {
      const doc = { id: `post-new-${createdPosts.length + 1}`, ...data }
      createdPosts.push(doc)
      return doc
    }),
  }

  const projectRepository = {
    listByUserId: vi.fn(async () => options.projects ?? [{ id: 'proj-1' }]),
    getById: vi.fn(async (id: string) => (options.projects ?? [{ id: 'proj-1' }]).find(project => project.id === id) ?? null),
  }

  const angleRepository = {
    getById: vi.fn(async (id: string) => (options.angles ?? []).find(angle => angle.id === id) ?? null),
  }

  const deviceRepository = {
    listCapableByUserId: vi.fn(async () => options.devices ?? [{ id: 'device-1', userId: 'user-1' }]),
    listCapableDevices: vi.fn(async () => options.devices ?? [{ id: 'device-1', userId: 'user-1' }]),
  }

  const executionTaskRepository = {
    countActiveByUserIdAndType: vi.fn(async () => options.activeSyncTasks ?? 0),
  }

  const executionTasksService = {
    create: vi.fn(async (userId: string, params: Record<string, unknown>) => {
      const task = { id: `task-${created.length + 1}`, userId, ...params }
      created.push(task)
      return task
    }),
  }

  const service = new CreatorNotesService(
    rowRepository as never,
    metricRepository as never,
    publishedPostRepository as never,
    projectRepository as never,
    angleRepository as never,
    deviceRepository as never,
    executionTaskRepository as never,
    executionTasksService as never,
  )

  return { service, created, metrics, rows, createdPosts, deviceRepository, executionTaskRepository, executionTasksService, rowRepository, metricRepository, projectRepository, publishedPostRepository }
}

describe('建采集工单', () => {
  it('规格由服务端下发，工单一定带 targetDeviceId 和平台能力要求', async () => {
    const fakes = build()

    await fakes.service.createSyncTask('user-1', { platform: 'xhs' })

    const task = fakes.created[0]!
    expect(task.type).toBe(ExecutionTaskType.SYNC_CREATOR_NOTES)
    // 创作平台要登录态，只有那台登录着的机器跑得了；派给别的机器只会重试到用尽
    expect(task.targetDeviceId).toBe('device-1')
    expect(task.requiredCapability).toBe('xhs')

    const payload = task.payload as { entryUrl: string, spec: Record<string, unknown> }
    expect(payload.entryUrl).toBe(findCollectProfile('xhs')!.entryUrl)
    expect(payload.spec).toEqual(findCollectProfile('xhs')!.spec)
  })

  /**
   * 规格里只有选择器和正则。带上可执行的东西，一个被改过的服务端
   * 就能让插件在用户的登录态下执行任意代码。
   */
  it('下发的规格里只有选择器和正则，没有任何可执行的东西', async () => {
    const spec = findCollectProfile('xhs')!.spec as unknown as Record<string, unknown>

    for (const value of Object.values(spec))
      expect(typeof value).not.toBe('function')

    expect(JSON.stringify(spec)).not.toMatch(/javascript:|<script|=>|function\s*\(/)
  })

  it('名下没有会干这活的机器：直接拒绝，不建一个注定失败的工单', async () => {
    const fakes = build({ devices: [] })

    await expect(fakes.service.createSyncTask('user-1', { platform: 'xhs' }))
      .rejects
      .toThrow(new AppException(ResponseCode.ExecutionTaskNoCapableDevice))
    expect(fakes.created).toHaveLength(0)
  })

  it('没有采集规格的平台直接拒绝', async () => {
    const fakes = build()

    await expect(fakes.service.createSyncTask('user-1', { platform: 'douyin' }))
      .rejects
      .toThrow(new AppException(ResponseCode.CreatorNoteSyncNoCollectSpec))
  })
})

describe('认领未归属的行', () => {
  const row = () => ({
    id: 'row-1',
    userId: 'user-1',
    matchState: CreatorNoteMatchState.UNMATCHED,
    matchCandidates: [],
    metrics: { views: 12, comments: 0, likes: 0, collects: 0, shares: 0 },
    collectedAt: new Date('2026-09-21T02:00:00.000Z'),
    executionTaskId: 'task-1',
    platform: 'xhs',
  })

  const post = {
    id: 'post-1',
    userId: 'user-1',
    projectId: 'proj-1',
    angleId: 'angle-1',
    platform: 'xhs',
  }

  it('认领后立刻补一个快照，不用等下一次采集', async () => {
    const fakes = build({ rows: [row()], posts: [post] })

    const updated = await fakes.service.claimRow('user-1', 'row-1', { publishedPostId: 'post-1' })

    expect(updated.matchState).toBe(CreatorNoteMatchState.MATCHED)
    expect(fakes.metrics).toHaveLength(1)
    expect(fakes.metrics[0]).toMatchObject({
      publishedPostId: 'post-1',
      projectId: 'proj-1',
      angleId: 'angle-1',
      userType: UserType.User,
    })
  })

  it('直接建记录：建出来标 discovered、状态直接是已发布，并立刻补上第一个快照', async () => {
    const fakes = build({
      rows: [row()],
      projects: [{ id: 'proj-1', userId: 'user-1', status: 'active' }],
      angles: [{ id: 'angle-9', projectId: 'proj-1' }],
    })

    const updated = await fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1', angleId: 'angle-9' })

    const post = fakes.createdPosts[0]!
    expect(post.source).toBe(PublishedPostSource.DISCOVERED)
    // 这条帖子本来就已经在平台上了，记成 pending 会在网页上多出一张「等你去发」的卡片
    expect(post.publishStatus).toBe(PublishedPostPublishStatus.PUBLISHED)
    expect(post.angleId).toBe('angle-9')
    // 列表页上没有正文，建出来的记录正文是空的，不编
    expect((post.snapshot as { body: string }).body).toBe('')
    expect(updated.matchState).toBe(CreatorNoteMatchState.MATCHED)
    expect(fakes.metrics).toHaveLength(1)
  })

  it('直接建记录：方向不属于这个项目就拒绝，不静默建一条没挂方向的', async () => {
    const fakes = build({
      rows: [row()],
      projects: [{ id: 'proj-1', userId: 'user-1', status: 'active' }],
      angles: [{ id: 'angle-9', projectId: 'proj-other' }],
    })

    await expect(fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1', angleId: 'angle-9' }))
      .rejects
      .toThrow(new AppException(ResponseCode.AngleNotFound))

    expect(fakes.createdPosts).toHaveLength(0)
  })

  it('直接建记录：建到别人的项目上按项目不存在拒绝', async () => {
    const fakes = build({
      rows: [row()],
      projects: [{ id: 'proj-1', userId: 'someone-else', status: 'active' }],
    })

    await expect(fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.ProjectNotFound))

    expect(fakes.createdPosts).toHaveLength(0)
  })

  /** 改归属会让两条帖子的折线都变错，而且错得看不出来 */
  it('已经归属过的不让再认领一次', async () => {
    const matched = { ...row(), matchState: CreatorNoteMatchState.MATCHED }
    const fakes = build({ rows: [matched], posts: [post] })

    await expect(fakes.service.claimRow('user-1', 'row-1', { publishedPostId: 'post-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.CreatorNoteRowAlreadyMatched))
  })

  it('认领到别人的发布记录上：按记录不存在拒绝', async () => {
    const fakes = build({ rows: [row()], posts: [] })

    await expect(fakes.service.claimRow('user-1', 'row-1', { publishedPostId: 'post-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.PublishedPostNotFound))
  })
})

describe('每 3 小时那一轮调度', () => {
  function scheduler(fakes: ReturnType<typeof build>) {
    return new CreatorNotesScheduler(fakes.deviceRepository as never, fakes.service)
  }

  it('从设备反查用户：有机器会干才建工单', async () => {
    const fakes = build()

    await scheduler(fakes).dispatchSyncTasks()

    expect(fakes.deviceRepository.listCapableDevices).toHaveBeenCalledWith(
      ['xhs', 'job:sync_creator_notes'],
      expect.any(Number),
    )
    expect(fakes.created).toHaveLength(1)
  })

  /** 那台机器可能整天离线，工单排着队等租约。不看一眼的话一周能攒出五十多个 */
  it('上一轮的还排着队就跳过这一轮', async () => {
    const fakes = build({ activeSyncTasks: 1 })

    await scheduler(fakes).dispatchSyncTasks()

    expect(fakes.created).toHaveLength(0)
  })

  it('一个用户有好几台机器登录着同一个平台，也只采一次', async () => {
    const fakes = build({
      devices: [
        { id: 'device-1', userId: 'user-1' },
        { id: 'device-2', userId: 'user-1' },
      ],
    })

    await scheduler(fakes).dispatchSyncTasks()

    expect(fakes.created).toHaveLength(1)
  })

  it('一个用户建不出来（没项目、机器刚吊销）不影响同一轮里的别人', async () => {
    const fakes = build({
      devices: [
        { id: 'device-1', userId: 'user-broken' },
        { id: 'device-2', userId: 'user-ok' },
      ],
    })
    fakes.executionTasksService.create.mockImplementationOnce(async () => {
      throw new AppException(ResponseCode.ProjectNotFound)
    })

    await scheduler(fakes).dispatchSyncTasks()

    expect(fakes.created).toHaveLength(1)
    expect(fakes.created[0]!.userId).toBe('user-ok')
  })
})

describe('数据页要的那几个查询', () => {
  const post = {
    id: 'post-1',
    userId: 'user-1',
    projectId: 'proj-1',
    snapshot: { title: '孕晚期焦虑' },
    publishedAt: new Date('2026-09-20T00:00:00.000Z'),
  }

  it('列数据行把用户和筛选条件一起交给仓储', async () => {
    const fakes = build({ rows: [{ id: 'row-1' }] })

    const result = await fakes.service.listRowsWithPagination('user-1', { page: 1, pageSize: 20 } as never)

    expect(fakes.rowRepository.listWithPagination).toHaveBeenCalledWith({ userId: 'user-1', page: 1, pageSize: 20 })
    expect(result.total).toBe(1)
  })

  it('数未归属的数量只数 unmatched 这一种', async () => {
    const fakes = build({ rows: [{ id: 'row-1' }] })

    await fakes.service.countUnmatched('user-1')

    expect(fakes.rowRepository.countByUserIdAndMatchState)
      .toHaveBeenCalledWith('user-1', CreatorNoteMatchState.UNMATCHED)
  })

  it('时间序列先确认这条帖子是自己的', async () => {
    const fakes = build({ posts: [post] })

    await fakes.service.listSeriesByPublishedPostId('user-1', 'post-1')

    expect(fakes.metricRepository.listByPublishedPostId).toHaveBeenCalledWith('post-1', 'user-1')
  })

  it('别人的帖子按记录不存在拒绝', async () => {
    const fakes = build({ posts: [] })

    await expect(fakes.service.listSeriesByPublishedPostId('user-1', 'post-1'))
      .rejects
      .toThrow(new AppException(ResponseCode.PublishedPostNotFound))
  })

  /**
   * 标题和发布时间在服务端配上再排序，不让网页自己去对：
   * 网页只拿得到一页发布记录，超出那一页的帖子会排到末尾，
   * 而「最新发的排最上面」恰恰是最容易被这件事破坏的。
   */
  it('趋势按发布时间倒序，最新发的排最前', async () => {
    const older = { ...post, id: 'post-old', publishedAt: new Date('2026-09-10T00:00:00.000Z'), snapshot: { title: '老帖子' } }
    const fakes = build({ posts: [post, older] })
    fakes.metricRepository.listTrendsByProjectId.mockResolvedValue([
      { publishedPostId: 'post-old', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
      { publishedPostId: 'post-1', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
    ] as never)

    const trends = await fakes.service.listProjectTrends('user-1', 'proj-1', {} as never)

    expect(trends.map(trend => trend.publishedPostId)).toEqual(['post-1', 'post-old'])
    expect(trends[0]!.title).toBe('孕晚期焦虑')
  })

  /** 没登记过发布时间的老记录当成「很久以前」，比当成「刚刚」诚实 */
  it('没有发布时间的排最后', async () => {
    const noDate = { ...post, id: 'post-no-date', publishedAt: undefined, snapshot: { title: '没登记过' } }
    const fakes = build({ posts: [post, noDate] })
    fakes.metricRepository.listTrendsByProjectId.mockResolvedValue([
      { publishedPostId: 'post-no-date', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
      { publishedPostId: 'post-1', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
    ] as never)

    const trends = await fakes.service.listProjectTrends('user-1', 'proj-1', {} as never)

    expect(trends.map(trend => trend.publishedPostId)).toEqual(['post-1', 'post-no-date'])
  })

  it('发布时间一样时按最近一次采集的先后排', async () => {
    const twin = { ...post, id: 'post-2', snapshot: { title: '同一天发的' } }
    const fakes = build({ posts: [post, twin] })
    fakes.metricRepository.listTrendsByProjectId.mockResolvedValue([
      { publishedPostId: 'post-1', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
      { publishedPostId: 'post-2', latestCollectedAt: new Date('2026-09-21T02:00:00.000Z') },
    ] as never)

    const trends = await fakes.service.listProjectTrends('user-1', 'proj-1', {} as never)

    expect(trends.map(trend => trend.publishedPostId)).toEqual(['post-2', 'post-1'])
  })

  /** 采回来直接建成记录的帖子没有草稿，标题拿不到时退回草稿路径，总好过空白 */
  it('快照标题是空的时候退回草稿路径', async () => {
    const noTitle = { ...post, id: 'post-3', snapshot: { title: '' }, draftPath: 'drafts/20260901-xhs-pain' }
    const fakes = build({ posts: [noTitle] })
    fakes.metricRepository.listTrendsByProjectId.mockResolvedValue([
      { publishedPostId: 'post-3', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
    ] as never)

    const trends = await fakes.service.listProjectTrends('user-1', 'proj-1', {} as never)

    expect(trends[0]!.title).toBe('drafts/20260901-xhs-pain')
  })

  it('趋势里有已经删掉的帖子时标题留空，不崩', async () => {
    const fakes = build({ posts: [] })
    fakes.metricRepository.listTrendsByProjectId.mockResolvedValue([
      { publishedPostId: 'post-gone', latestCollectedAt: new Date('2026-09-21T00:00:00.000Z') },
    ] as never)

    const trends = await fakes.service.listProjectTrends('user-1', 'proj-1', {} as never)

    expect(trends[0]!.title).toBe('')
  })

  it('按方向汇总把项目和时间窗口交给仓储', async () => {
    const fakes = build()

    await fakes.service.listAngleTotals('user-1', 'proj-1', { days: 7 } as never)

    expect(fakes.metricRepository.listAngleTotalsByProjectId).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', projectId: 'proj-1' }),
    )
  })

  it('数在跑的采集工单只数 sync_creator_notes 这一种', async () => {
    const fakes = build({ activeSyncTasks: 2 })

    const count = await fakes.service.countActiveSyncTasks('user-1')

    expect(count).toBe(2)
    expect(fakes.executionTaskRepository.countActiveByUserIdAndType)
      .toHaveBeenCalledWith('user-1', ExecutionTaskType.SYNC_CREATOR_NOTES)
  })
})

describe('建工单时挂哪个项目', () => {
  /** 工单模型要求有 projectId，但采集是按平台加账号来的，挂哪个项目不影响归因 */
  it('一个项目都没有时直接拒绝，不建一个挂不上的工单', async () => {
    const fakes = build({ projects: [] })

    await expect(fakes.service.createSyncTask('user-1', { platform: 'xhs' }))
      .rejects
      .toThrow(new AppException(ResponseCode.ProjectNotFound))
    expect(fakes.created).toHaveLength(0)
  })
})

describe('直接建记录的其余拦截', () => {
  const row = () => ({
    id: 'row-1',
    userId: 'user-1',
    matchState: CreatorNoteMatchState.UNMATCHED,
    matchCandidates: [],
    metrics: { views: 12, comments: 0, likes: 0, collects: 0, shares: 0 },
    collectedAt: new Date('2026-09-21T02:00:00.000Z'),
    executionTaskId: 'task-1',
    platform: 'xhs',
  })

  it('归档项目不让再往里建记录', async () => {
    const fakes = build({
      rows: [row()],
      projects: [{ id: 'proj-1', userId: 'user-1', status: 'archived' }],
    })

    await expect(fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.ProjectArchived))
    expect(fakes.createdPosts).toHaveLength(0)
  })

  it('这一行本来就不存在时按行不存在拒绝', async () => {
    const fakes = build({ rows: [] })

    await expect(fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.CreatorNoteRowNotFound))
  })

  it('已经归属过的不让再建一条', async () => {
    const fakes = build({
      rows: [{ ...row(), matchState: CreatorNoteMatchState.MATCHED }],
      projects: [{ id: 'proj-1', userId: 'user-1', status: 'active' }],
    })

    await expect(fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.CreatorNoteRowAlreadyMatched))
  })

  it('记录建不出来时说清楚是建失败，不是别的', async () => {
    const fakes = build({
      rows: [row()],
      projects: [{ id: 'proj-1', userId: 'user-1', status: 'active' }],
    })
    fakes.publishedPostRepository.create.mockResolvedValueOnce(null as never)

    await expect(fakes.service.adoptRow('user-1', 'row-1', { projectId: 'proj-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.CreatorNoteRowAdoptFailed))
  })

  it('认领一行不存在的数据时按行不存在拒绝', async () => {
    const fakes = build({ rows: [] })

    await expect(fakes.service.claimRow('user-1', 'row-1', { publishedPostId: 'post-1' }))
      .rejects
      .toThrow(new AppException(ResponseCode.CreatorNoteRowNotFound))
  })
})
