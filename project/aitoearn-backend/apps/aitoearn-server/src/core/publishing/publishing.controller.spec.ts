/**
 * 发布接口的路由装配：每个入口把 service 的结果转成 VO，该带的参数一个都不能漏。
 */
import type { TokenInfo } from '@yikart/aitoearn-auth'
import { Test } from '@nestjs/testing'
import {
  PublishedPostLinkStatus,
  PublishedPostPublishStatus,
  PublishedPostSource,
} from '@yikart/mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishingController } from './publishing.controller'
import { PublishingService } from './publishing.service'

vi.mock('../../config', () => ({
  config: {
    projects: { root: '/tmp/aitoearn-test-projects' },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

/** schema 里有联合类型的字段，@Prop 在测试环境推不出类型，这里让它不做事 */
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

const TOKEN = { id: 'user-1' } as TokenInfo
const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'
const POST_ID = '68c4b3f0a1b2c3d4e5f60719'
const NOW = new Date('2026-09-21T03:00:00.000Z')

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    projectId: PROJECT_ID,
    angleId: 'a1',
    draftPath: 'drafts/20260901-xhs-pain',
    platform: 'xhs',
    accountId: null,
    executionTaskId: 'task-1',
    publishStatus: PublishedPostPublishStatus.PENDING,
    source: PublishedPostSource.REGISTERED,
    linkStatus: PublishedPostLinkStatus.NONE,
    platformPostId: null,
    postUrl: null,
    publishedAt: null,
    failReason: null,
    snapshot: { title: '孕晚期焦虑', body: '正文正文', topics: ['孕晚期'], mediaUrls: ['https://oss/a.png'] },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('发布接口的路由装配', () => {
  let controller: PublishingController
  let service: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    service = {
      createFromDraft: vi.fn(),
      listWithPagination: vi.fn(),
      getDetail: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      remove: vi.fn(),
    }

    // compile() 真的会把 controller 和它身上的装饰器装配一遍，
    // 装饰器写错或依赖缺失在这里就会炸，不用等应用启动
    const moduleRef = await Test.createTestingModule({
      controllers: [PublishingController],
      providers: [{ provide: PublishingService, useValue: service }],
    }).compile()

    controller = moduleRef.get(PublishingController)
  })

  /** 三条草稿提示只有建单那一刻说得清，列表里再看就没有了，所以必须跟着返回 */
  it('从草稿建单时把记录和三条草稿提示一起带回来', async () => {
    service.createFromDraft!.mockResolvedValue({
      post: post(),
      skippedMedia: [{ path: 'media/b.png', reason: 'oss_missing' }],
      mediaDeclared: true,
      bodyFallback: false,
    })

    const vo = await controller.createFromDraft(TOKEN, PROJECT_ID, {
      draftPath: 'drafts/20260901-xhs-pain',
      platform: 'xhs',
      mode: 'manual',
    } as never)

    expect(service.createFromDraft).toHaveBeenCalledWith(PROJECT_ID, 'user-1', {
      draftPath: 'drafts/20260901-xhs-pain',
      platform: 'xhs',
      mode: 'manual',
    })
    expect(vo.post.id).toBe(POST_ID)
    expect(vo.post.snapshot.title).toBe('孕晚期焦虑')
    expect(vo.skippedMedia).toHaveLength(1)
    expect(vo.mediaDeclared).toBe(true)
    expect(vo.bodyFallback).toBe(false)
  })

  it('列表把筛选条件透传下去，并按分页 VO 返回', async () => {
    service.listWithPagination!.mockResolvedValue({ list: [post()], total: 1 })
    const query = { page: 1, pageSize: 20, platform: 'xhs' }

    const vo = await controller.listWithPagination(TOKEN, PROJECT_ID, query as never)

    expect(service.listWithPagination).toHaveBeenCalledWith(PROJECT_ID, 'user-1', query)
    expect(vo.total).toBe(1)
    expect(vo.list[0]!.title).toBe('孕晚期焦虑')
    expect(vo.list[0]!.mediaCount).toBe(1)
  })

  it('详情带上完整的内容快照', async () => {
    service.getDetail!.mockResolvedValue(post())

    const vo = await controller.getDetail(TOKEN, PROJECT_ID, POST_ID)

    expect(service.getDetail).toHaveBeenCalledWith(PROJECT_ID, POST_ID, 'user-1')
    expect(vo.snapshot.body).toBe('正文正文')
    expect(vo.snapshot.topics).toEqual(['孕晚期'])
  })

  it('回填链接之后记录转成已发布加已认领', async () => {
    service.complete!.mockResolvedValue(post({
      publishStatus: PublishedPostPublishStatus.PUBLISHED,
      linkStatus: PublishedPostLinkStatus.CLAIMED,
      postUrl: 'https://www.xiaohongshu.com/explore/1',
      publishedAt: NOW,
    }))

    const vo = await controller.complete(TOKEN, PROJECT_ID, POST_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/1',
    } as never)

    expect(service.complete).toHaveBeenCalledWith(PROJECT_ID, POST_ID, 'user-1', {
      postUrl: 'https://www.xiaohongshu.com/explore/1',
    })
    expect(vo.publishStatus).toBe(PublishedPostPublishStatus.PUBLISHED)
    expect(vo.linkStatus).toBe(PublishedPostLinkStatus.CLAIMED)
  })

  it('标失败之后把原因带回来', async () => {
    service.fail!.mockResolvedValue(post({
      publishStatus: PublishedPostPublishStatus.FAILED,
      failReason: '平台限流',
    }))

    const vo = await controller.fail(TOKEN, PROJECT_ID, POST_ID, { reason: '平台限流' } as never)

    expect(service.fail).toHaveBeenCalledWith(PROJECT_ID, POST_ID, 'user-1', { reason: '平台限流' })
    expect(vo.failReason).toBe('平台限流')
  })

  /** 一并删掉的工单 id 也要回给前端，不然前端不知道那张工单没了 */
  it('删除返回被删的记录和一并删掉的工单', async () => {
    service.remove!.mockResolvedValue({ id: POST_ID, executionTaskId: 'task-1' })

    const vo = await controller.remove(TOKEN, PROJECT_ID, POST_ID)

    expect(service.remove).toHaveBeenCalledWith(PROJECT_ID, POST_ID, 'user-1')
    expect(vo.id).toBe(POST_ID)
    expect(vo.executionTaskId).toBe('task-1')
  })
})
