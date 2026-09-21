/**
 * 采集接口的路由装配：每个入口把 service 的结果转成 VO，该带的参数一个都不能漏。
 */
import type { TokenInfo } from '@yikart/aitoearn-auth'
import { Test } from '@nestjs/testing'
import { CreatorNoteMatchState } from '@yikart/mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreatorNotesController } from './creator-notes.controller'
import { CreatorNotesService } from './creator-notes.service'

vi.mock('../../config', () => ({
  config: {
    projects: { root: '/tmp/aitoearn-test-projects' },
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

/** schema 里有联合类型的字段，@Prop 在测试环境推不出类型，这里让它不做事 */
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

const TOKEN = { id: 'user-1' } as TokenInfo
const ROW_ID = '68c4b3f0a1b2c3d4e5f60718'
const POST_ID = '68c4b3f0a1b2c3d4e5f60719'
const PROJECT_ID = '68c4b3f0a1b2c3d4e5f6071a'
const NOW = new Date('2026-09-21T03:00:00.000Z')

const METRICS = { views: 120, comments: 3, likes: 20, collects: 5, shares: 1 }

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    platform: 'xhs',
    accountId: 'acc-1',
    title: '孕晚期焦虑',
    titleTruncated: false,
    publishedAtText: '09-20',
    publishedAt: NOW,
    metrics: METRICS,
    collectedAt: NOW,
    executionTaskId: 'task-1',
    matchedPublishedPostId: undefined,
    matchState: CreatorNoteMatchState.UNMATCHED,
    matchCandidates: [],
    ...overrides,
  }
}

describe('采集接口的路由装配', () => {
  let controller: CreatorNotesController
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    service = {
      createSyncTask: vi.fn(),
      listRowsWithPagination: vi.fn(),
      claimRow: vi.fn(),
      adoptRow: vi.fn(),
      listSeriesByPublishedPostId: vi.fn(),
      listProjectTrends: vi.fn(),
      listAngleTotals: vi.fn(),
    }

    // compile() 真的会把 controller 和它身上的装饰器装配一遍，
    // 装饰器写错或依赖缺失在这里就会炸，不用等应用启动
    const moduleRef = await Test.createTestingModule({
      controllers: [CreatorNotesController],
      providers: [{ provide: CreatorNotesService, useValue: service }],
    }).compile()

    controller = moduleRef.get(CreatorNotesController)
  })

  it('立刻采一次会把建出来的工单转成工单详情 VO', async () => {
    service.createSyncTask!.mockResolvedValue({
      id: 'task-1',
      projectId: PROJECT_ID,
      angleId: null,
      type: 'sync_creator_notes',
      mode: 'auto',
      status: 'pending',
      targetDeviceId: null,
      deviceId: null,
      requiredCapability: 'xhs',
      error: null,
      errorCode: null,
      attempts: 0,
      maxAttempts: 3,
      availableAt: NOW,
      leaseExpiresAt: null,
      priority: 0,
      startedAt: null,
      finishedAt: null,
      payload: { platform: 'xhs' },
      result: null,
      createdAt: NOW,
      updatedAt: NOW,
    })

    const vo = await controller.createSyncTask(TOKEN, { platform: 'xhs' } as never)

    expect(service.createSyncTask).toHaveBeenCalledWith('user-1', { platform: 'xhs' })
    expect(vo.id).toBe('task-1')
    expect(vo.requiredCapability).toBe('xhs')
  })

  it('数据行列表把筛选条件透传下去，并按分页 VO 返回', async () => {
    service.listRowsWithPagination!.mockResolvedValue({ list: [row()], total: 1 })
    const query = { page: 1, pageSize: 20, matchState: CreatorNoteMatchState.UNMATCHED }

    const vo = await controller.listRowsWithPagination(TOKEN, query as never)

    expect(service.listRowsWithPagination).toHaveBeenCalledWith('user-1', query)
    expect(vo.total).toBe(1)
    expect(vo.list[0]!.title).toBe('孕晚期焦虑')
    expect(vo.list[0]!.matchState).toBe(CreatorNoteMatchState.UNMATCHED)
  })

  it('认领一行之后返回的是归属好的那一行', async () => {
    service.claimRow!.mockResolvedValue(row({
      matchState: CreatorNoteMatchState.MATCHED,
      matchedPublishedPostId: POST_ID,
    }))

    const vo = await controller.claimRow(TOKEN, ROW_ID, { publishedPostId: POST_ID } as never)

    expect(service.claimRow).toHaveBeenCalledWith('user-1', ROW_ID, { publishedPostId: POST_ID })
    expect(vo.matchedPublishedPostId).toBe(POST_ID)
  })

  it('把一行建成发布记录之后同样返回归属好的那一行', async () => {
    service.adoptRow!.mockResolvedValue(row({
      matchState: CreatorNoteMatchState.MATCHED,
      matchedPublishedPostId: POST_ID,
    }))

    const vo = await controller.adoptRow(TOKEN, ROW_ID, { projectId: PROJECT_ID } as never)

    expect(service.adoptRow).toHaveBeenCalledWith('user-1', ROW_ID, { projectId: PROJECT_ID })
    expect(vo.matchState).toBe(CreatorNoteMatchState.MATCHED)
  })

  it('一条帖子的时间序列按采集点逐个转成 VO', async () => {
    const earlier = new Date('2026-09-20T03:00:00.000Z')
    service.listSeriesByPublishedPostId!.mockResolvedValue([
      { collectedAt: earlier, metrics: METRICS },
      { collectedAt: NOW, metrics: METRICS },
    ])

    const vos = await controller.listSeries(TOKEN, POST_ID)

    expect(service.listSeriesByPublishedPostId).toHaveBeenCalledWith('user-1', POST_ID)
    expect(vos).toHaveLength(2)
    expect(vos[0]!.collectedAt).toEqual(earlier)
  })

  it('项目趋势把当前值和增量一起带出来', async () => {
    service.listProjectTrends!.mockResolvedValue([{
      publishedPostId: POST_ID,
      title: '孕晚期焦虑',
      publishedAt: NOW,
      latest: METRICS,
      delta: { views: 20, comments: 1, likes: 2, collects: 0, shares: 0 },
      latestCollectedAt: NOW,
      snapshotCount: 2,
    }])

    const vos = await controller.listProjectTrends(TOKEN, PROJECT_ID, { days: 7 } as never)

    expect(service.listProjectTrends).toHaveBeenCalledWith('user-1', PROJECT_ID, { days: 7 })
    expect(vos[0]!.latest.views).toBe(120)
    expect(vos[0]!.delta!.views).toBe(20)
  })

  /** 没挂方向的那一堆汇总在 angleId 缺省的那一条里，VO 里不该冒出一个 null */
  it('按方向汇总时没挂方向的那一条不带 angleId', async () => {
    service.listAngleTotals!.mockResolvedValue([
      { angleId: 'a1', postCount: 2, totals: METRICS },
      { angleId: null, postCount: 1, totals: METRICS },
    ])

    const vos = await controller.listAngleTotals(TOKEN, PROJECT_ID, { days: 7 } as never)

    expect(service.listAngleTotals).toHaveBeenCalledWith('user-1', PROJECT_ID, { days: 7 })
    expect(vos[0]!.angleId).toBe('a1')
    expect(vos[1]!.angleId).toBeUndefined()
  })
})
