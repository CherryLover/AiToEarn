import { AppException, ResponseCode } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MANUAL_ACCOUNT_PLACEHOLDER, PublishingService } from './publishing.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/data/projects' } },
}))

vi.mock('@yikart/mongodb', () => ({
  AngleRepository: class AngleRepository {},
  ExecutionTaskRepository: class ExecutionTaskRepository {},
  ExecutionTaskMode: { AUTO: 'auto', MANUAL: 'manual' },
  ExecutionTaskType: { PUBLISH: 'publish', CLAIM_LINK: 'claim_link', COLLECT_METRICS: 'collect_metrics', ECHO: 'echo' },
  PublishedPostRepository: class PublishedPostRepository {},
  PublishedPostPublishStatus: {
    PENDING: 'pending',
    PUBLISHING: 'publishing',
    PUBLISHED: 'published',
    FAILED: 'failed',
  },
  PublishedPostLinkStatus: { NONE: 'none', CLAIMED: 'claimed', CLAIM_FAILED: 'claim_failed' },
}))

vi.mock('../projects/projects.service', () => ({
  ProjectsService: class ProjectsService {},
}))

vi.mock('../execution-tasks/execution-tasks.service', () => ({
  ExecutionTasksService: class ExecutionTasksService {},
}))

const USER_ID = 'user-1'
const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'
const OTHER_PROJECT_ID = '68c4b3f0a1b2c3d4e5f60719'
const POST_ID = '68c4b3f0a1b2c3d4e5f60001'
const TASK_ID = '68c4b3f0a1b2c3d4e5f60002'
const ANGLE_ID = '68c4b3f0a1b2c3d4e5f60003'
const NOW = new Date('2026-09-18T05:00:00.000Z')

const SNAPSHOT = {
  title: '导出藏得太深，四步变一步',
  body: '正文第一段。',
  topics: ['效率工具'],
  mediaUrls: ['https://oss.example.com/k/home.png'],
}

interface StoredPost {
  id: string
  userId: string
  projectId: string
  angleId?: string
  draftPath: string
  platform: string
  accountId?: string
  snapshot: typeof SNAPSHOT
  executionTaskId?: string
  publishStatus: string
  linkStatus: string
  platformPostId?: string
  postUrl?: string
  publishedAt?: Date
  failReason?: string
  createdAt: Date
  updatedAt: Date
}

function postDoc(overrides: Partial<StoredPost> = {}): StoredPost {
  return {
    id: POST_ID,
    userId: USER_ID,
    projectId: PROJECT_ID,
    draftPath: 'drafts/2026-09-18-xhs-export-friction',
    platform: 'xhs',
    snapshot: SNAPSHOT,
    executionTaskId: TASK_ID,
    publishStatus: 'pending',
    linkStatus: 'none',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/**
 * 仓库用一个内存数组顶替，`create` / `updateXxx` / `deleteXxx` 之间是连着的，
 * 这样才测得动「建到一半失败要把已建的清理掉」这种跨调用的行为。
 */
function createService(options: {
  stored?: StoredPost[]
  draft?: Record<string, unknown>
  publishedPostRepository?: Record<string, unknown>
  executionTaskRepository?: Record<string, unknown>
  executionTasksService?: Record<string, unknown>
  angleRepository?: Record<string, unknown>
} = {}) {
  const stored = options.stored ?? []
  const tasks: { id: string, deleted: boolean }[] = []
  /** 工单状态：没记过的按 pending 算，够用来盯住「取消过还能不能回填」这条线 */
  const taskStatus = new Map<string, string>()
  let seq = 0

  const publishedPostRepository = {
    create: vi.fn(async (data: Partial<StoredPost>) => {
      seq += 1
      const doc: StoredPost = {
        ...postDoc({ executionTaskId: undefined }),
        ...data,
        id: `post-${seq}`,
        createdAt: NOW,
        updatedAt: NOW,
      } as StoredPost
      stored.push(doc)
      return { ...doc }
    }),
    getByIdAndUserId: vi.fn(async (id: string, userId: string) => {
      const found = stored.find(post => post.id === id && post.userId === userId)
      return found ? { ...found } : null
    }),
    countByPlatformPostId: vi.fn(async (platform: string, platformPostId: string, excludeId?: string) =>
      stored.filter(post =>
        post.platform === platform
        && post.platformPostId === platformPostId
        && post.id !== excludeId,
      ).length),
    updateExecutionTaskIdById: vi.fn(async (id: string, executionTaskId: string) => {
      const found = stored.find(post => post.id === id)
      if (!found)
        return null

      found.executionTaskId = executionTaskId
      return { ...found }
    }),
    updateAsPublishedById: vi.fn(async (params: {
      id: string
      userId: string
      postUrl: string
      platformPostId?: string
      publishedAt: Date
    }) => {
      const found = stored.find(post =>
        post.id === params.id && post.userId === params.userId && post.publishStatus !== 'published')
      if (!found)
        return null

      found.publishStatus = 'published'
      found.linkStatus = 'claimed'
      found.postUrl = params.postUrl
      if (params.platformPostId)
        found.platformPostId = params.platformPostId
      found.publishedAt = params.publishedAt
      found.failReason = undefined
      return { ...found }
    }),
    updateAsFailedById: vi.fn(async (id: string, userId: string, reason: string) => {
      const found = stored.find(post =>
        post.id === id && post.userId === userId && post.publishStatus !== 'published')
      if (!found)
        return null

      found.publishStatus = 'failed'
      found.failReason = reason
      return { ...found }
    }),
    deleteById: vi.fn(async (id: string) => {
      const index = stored.findIndex(post => post.id === id)
      if (index < 0)
        return null

      return stored.splice(index, 1)[0]!
    }),
    deleteByIdAndUserId: vi.fn(async (id: string, userId: string) => {
      const index = stored.findIndex(post => post.id === id && post.userId === userId)
      if (index < 0)
        return false

      stored.splice(index, 1)
      return true
    }),
    listWithPagination: vi.fn(async () => ({ list: stored.map(post => ({ ...post })), total: stored.length })),
    ...options.publishedPostRepository,
  }

  const executionTaskRepository = {
    getByIdAndUserId: vi.fn(async (id: string) => {
      const found = tasks.find(task => task.id === id && !task.deleted)
      return found ? { id: found.id } : null
    }),
    deleteById: vi.fn(async (id: string) => {
      const found = tasks.find(task => task.id === id)
      if (found)
        found.deleted = true
      return found ? { id } : null
    }),
    updateAsCancelledById: vi.fn(async (id: string) => {
      taskStatus.set(id, 'cancelled')
      return { id, status: 'cancelled' }
    }),
    ...options.executionTaskRepository,
  }

  const executionTasksService = {
    create: vi.fn(async () => {
      tasks.push({ id: TASK_ID, deleted: false })
      return { id: TASK_ID }
    }),
    // 照 execution-task.repository 的守卫来：pending / cancelled 认，已经成功的不认
    completeManual: vi.fn(async (id: string = TASK_ID) => {
      const current = taskStatus.get(id) ?? 'pending'
      if (current !== 'pending' && current !== 'cancelled')
        throw new AppException(ResponseCode.ExecutionTaskStatusInvalid)

      taskStatus.set(id, 'succeeded')
      return { id, status: 'succeeded' }
    }),
    ...options.executionTasksService,
  }

  const angleRepository = {
    getBySlug: vi.fn(async (_projectId: string, slug: string) =>
      (slug === 'export-friction' ? { id: ANGLE_ID } : null)),
    ...options.angleRepository,
  }

  const projectsService = {
    getWritableProject: vi.fn(async (id: string) => {
      if (id !== PROJECT_ID && id !== OTHER_PROJECT_ID)
        throw new AppException(ResponseCode.ProjectNotFound)

      return { id, dirName: 'fortyweeks' }
    }),
  }

  const draftSnapshotService = {
    read: vi.fn(async () => ({
      draftPath: 'drafts/2026-09-18-xhs-export-friction',
      snapshot: SNAPSHOT,
      angleSlug: 'export-friction',
      draftPlatform: 'xhs',
      skippedMedia: [{ path: 'media/broken.png', reason: 'oss_missing' }],
      bodyFallback: false,
      mediaDeclared: true,
      ...options.draft,
    })),
  }

  const service = new PublishingService(
    publishedPostRepository as never,
    executionTaskRepository as never,
    angleRepository as never,
    projectsService as never,
    draftSnapshotService as never,
    executionTasksService as never,
  )

  return { service, stored, tasks, taskStatus, publishedPostRepository, executionTaskRepository, executionTasksService, draftSnapshotService }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('从草稿建发布工单', () => {
  it('mode=auto 直接拒绝，这一轮没有自动发布', async () => {
    const { service, stored, executionTasksService } = createService()

    await expect(service.createFromDraft(PROJECT_ID, USER_ID, {
      draftPath: 'drafts/2026-09-18-xhs-export-friction',
      platform: 'xhs',
      mode: 'auto',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostAutoModeNotSupported })

    // 拒得够早：既没读草稿也没建任何东西
    expect(stored).toHaveLength(0)
    expect(executionTasksService.create).not.toHaveBeenCalled()
  })

  it('快照进记录、进工单载荷，两边互相引用，跳过的图片如实报出来', async () => {
    const { service, executionTasksService } = createService()

    const { post, skippedMedia } = await service.createFromDraft(PROJECT_ID, USER_ID, {
      draftPath: 'drafts/2026-09-18-xhs-export-friction',
      platform: 'xhs',
      mode: 'manual',
    } as never)

    expect(post.snapshot).toEqual(SNAPSHOT)
    expect(post.publishStatus).toBe('pending')
    expect(post.linkStatus).toBe('none')
    expect(post.executionTaskId).toBe(TASK_ID)
    // 血缘里的方向 slug 换成了方向 id，阶段 5 才归得了因
    expect(post.angleId).toBe(ANGLE_ID)
    expect(skippedMedia).toEqual([{ path: 'media/broken.png', reason: 'oss_missing' }])

    expect(executionTasksService.create).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      type: 'publish',
      mode: 'manual',
      angleId: ANGLE_ID,
      payload: expect.objectContaining({
        platform: 'xhs',
        accountId: MANUAL_ACCOUNT_PLACEHOLDER,
        draftPath: 'drafts/2026-09-18-xhs-export-friction',
        snapshot: SNAPSHOT,
      }),
    }))
  })

  it('草稿血缘里的方向对不上时不挂方向，但照样建得出来', async () => {
    const { service } = createService({ draft: { angleSlug: 'ghost-angle' } })

    const { post } = await service.createFromDraft(PROJECT_ID, USER_ID, {
      draftPath: 'drafts/2026-09-18-xhs-export-friction',
      platform: 'xhs',
      mode: 'manual',
    } as never)

    expect(post.angleId).toBeUndefined()
  })

  it('建工单失败时，已经建出来的发布记录被清理掉', async () => {
    const { service, stored, publishedPostRepository } = createService({
      executionTasksService: {
        create: vi.fn(async () => {
          throw new Error('mongo down')
        }),
      },
    })

    await expect(service.createFromDraft(PROJECT_ID, USER_ID, {
      draftPath: 'drafts/2026-09-18-xhs-export-friction',
      platform: 'xhs',
      mode: 'manual',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostCreateFailed })

    expect(publishedPostRepository.deleteById).toHaveBeenCalled()
    expect(stored).toHaveLength(0)
  })

  it('回填工单 id 那一步失败时，记录和工单都清掉，不留孤儿', async () => {
    const { service, stored, tasks, executionTaskRepository } = createService({
      publishedPostRepository: {
        updateExecutionTaskIdById: vi.fn(async () => null),
      },
    })

    await expect(service.createFromDraft(PROJECT_ID, USER_ID, {
      draftPath: 'drafts/2026-09-18-xhs-export-friction',
      platform: 'xhs',
      mode: 'manual',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostCreateFailed })

    expect(executionTaskRepository.deleteById).toHaveBeenCalledWith(TASK_ID)
    expect(tasks.every(task => task.deleted)).toBe(true)
    expect(stored).toHaveLength(0)
  })
})

describe('人工回填帖子链接', () => {
  it('两个状态一起推到位，工单跟着转成功', async () => {
    const { service, executionTasksService } = createService({ stored: [postDoc()] })

    const post = await service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
      platformPostId: 'abc',
    } as never)

    expect(post.publishStatus).toBe('published')
    expect(post.linkStatus).toBe('claimed')
    expect(post.postUrl).toBe('https://www.xiaohongshu.com/explore/abc')
    expect(post.platformPostId).toBe('abc')
    expect(post.publishedAt).toBeInstanceOf(Date)

    expect(executionTasksService.completeManual).toHaveBeenCalledWith(
      TASK_ID,
      USER_ID,
      { platformPostId: 'abc', postUrl: 'https://www.xiaohongshu.com/explore/abc' },
    )
  })

  it('同一个平台上的同一条帖子不许登记两次', async () => {
    const { service } = createService({
      stored: [
        postDoc({ id: 'post-old', publishStatus: 'published', linkStatus: 'claimed', platformPostId: 'abc' }),
        postDoc(),
      ],
    })

    await expect(service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
      platformPostId: 'abc',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostDuplicate })
  })

  it('唯一索引那一层撞车时翻译成人话，不把数据库报错抛给用户', async () => {
    const { service } = createService({
      stored: [postDoc()],
      publishedPostRepository: {
        updateAsPublishedById: vi.fn(async () => {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
        }),
      },
    })

    await expect(service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
      platformPostId: 'abc',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostDuplicate })
  })

  it('已经登记成功的记录不能再回填一次', async () => {
    const { service } = createService({
      stored: [postDoc({ publishStatus: 'published', linkStatus: 'claimed', platformPostId: 'abc' })],
    })

    await expect(service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/def',
      platformPostId: 'def',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostAlreadyCompleted })
  })

  it('链接不是 http/https 直接拒', async () => {
    const { service } = createService({ stored: [postDoc()] })

    await expect(service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'javascript:alert(1)',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostUrlInvalid })
  })

  it('工单没能跟着转成功时，发布记录照样算登记成功', async () => {
    const { service } = createService({
      stored: [postDoc()],
      executionTasksService: {
        completeManual: vi.fn(async () => {
          throw new AppException(ResponseCode.ExecutionTaskStatusInvalid)
        }),
      },
    })

    const post = await service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
    } as never)

    expect(post.publishStatus).toBe('published')
    expect(post.linkStatus).toBe('claimed')
  })

  it('别的项目下的记录碰不到', async () => {
    const { service } = createService({ stored: [postDoc()] })

    await expect(service.complete(OTHER_PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostProjectMismatch })
  })

  it('别人的记录当作不存在', async () => {
    const { service } = createService({ stored: [postDoc({ userId: 'user-2' })] })

    await expect(service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
    } as never)).rejects.toMatchObject({ code: ResponseCode.PublishedPostNotFound })
  })
})

describe('人工标记发失败 / 删掉登记', () => {
  it('标记失败会记下原因，并把对应的手动工单取消掉', async () => {
    const { service, executionTaskRepository } = createService({ stored: [postDoc()] })

    const post = await service.fail(PROJECT_ID, POST_ID, USER_ID, { reason: '被平台判违规' } as never)

    expect(post.publishStatus).toBe('failed')
    expect(post.failReason).toBe('被平台判违规')
    // 链接状态是另一个维度，不跟着发布状态一起变
    expect(post.linkStatus).toBe('none')
    expect(executionTaskRepository.updateAsCancelledById).toHaveBeenCalledWith(TASK_ID, USER_ID, expect.any(Date))
  })

  it('已经发出去的不能改成失败', async () => {
    const { service } = createService({ stored: [postDoc({ publishStatus: 'published', linkStatus: 'claimed' })] })

    await expect(service.fail(PROJECT_ID, POST_ID, USER_ID, { reason: '手滑' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.PublishedPostAlreadyCompleted })
  })

  it('先标发失败、后来又真发出去了：记录和工单一起回到成功', async () => {
    const { service, taskStatus, executionTasksService } = createService({ stored: [postDoc()] })

    await service.fail(PROJECT_ID, POST_ID, USER_ID, { reason: '当时没发成' } as never)
    expect(taskStatus.get(TASK_ID)).toBe('cancelled')

    const post = await service.complete(PROJECT_ID, POST_ID, USER_ID, {
      postUrl: 'https://www.xiaohongshu.com/explore/abc',
    } as never)

    expect(post.publishStatus).toBe('published')
    expect(post.linkStatus).toBe('claimed')
    // 工单卡在 cancelled 的话，这条帖子到阶段 5 统计时就没有工单了（骨架第六节）
    expect(executionTasksService.completeManual).toHaveBeenCalled()
    expect(taskStatus.get(TASK_ID)).toBe('succeeded')
  })

  it('删登记时记录和工单一起删，草稿文件一个字都不碰', async () => {
    const { service, stored, tasks, executionTaskRepository, draftSnapshotService } = createService({
      stored: [postDoc()],
    })
    tasks.push({ id: TASK_ID, deleted: false })

    const removed = await service.remove(PROJECT_ID, POST_ID, USER_ID)

    expect(removed).toEqual({ id: POST_ID, executionTaskId: TASK_ID })
    expect(stored).toHaveLength(0)
    expect(executionTaskRepository.deleteById).toHaveBeenCalledWith(TASK_ID)
    expect(draftSnapshotService.read).not.toHaveBeenCalled()
  })
})
