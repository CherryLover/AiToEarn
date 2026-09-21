/**
 * 建采集工单、认领未归属的行、每 3 小时那一轮调度。
 */
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { CreatorNoteMatchState, ExecutionTaskType } from '@yikart/mongodb'
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
  projects?: { id: string }[]
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

  const publishedPostRepository = {
    getByIdAndUserId: vi.fn(async (id: string) => (options.posts ?? []).find(post => post.id === id) ?? null),
  }

  const projectRepository = {
    listByUserId: vi.fn(async () => options.projects ?? [{ id: 'proj-1' }]),
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
    deviceRepository as never,
    executionTaskRepository as never,
    executionTasksService as never,
  )

  return { service, created, metrics, rows, deviceRepository, executionTaskRepository, executionTasksService }
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
