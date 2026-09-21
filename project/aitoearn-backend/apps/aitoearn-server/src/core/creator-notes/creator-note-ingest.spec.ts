/**
 * 采回来的数据怎么落地、怎么归属。
 *
 * 这条链路的每一种错都是静默的：归错了帖子、归成未归属、重复回报落两份，
 * 页面上都照常显示一堆数字。所以四种归属结果和重复回报各钉一条用例。
 */
import { UserType } from '@yikart/common'
import { CreatorNoteMatchState, PublishedPostSource } from '@yikart/mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreatorNoteIngestService } from './creator-note-ingest.service'
import { CreatorNoteMatcherService } from './creator-note-matcher.service'

// 这条链路会带出 ProjectDirService -> config，测试环境下不读真实配置
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

const COLLECTED_AT = '2026-09-21T02:00:00.000Z'

/** 实测那三条：浏览 3030 / 评论 9 / 点赞 1，特别用来确认赞和评论没对调 */
const NOTE_KNOWN = {
  title: '结婚 4 年生出来个这……',
  titleTruncated: false,
  publishedAtText: '2026-09-18 08:28',
  metrics: { views: 3030, comments: 9, likes: 1, collects: 0, shares: 0 },
}

const NOTE_FROM_DRAFT = {
  title: '做了个按孕周排的孕期日历，求孕妈们挑刺',
  titleTruncated: false,
  publishedAtText: '2026-09-17 11:24',
  metrics: { views: 717, comments: 3, likes: 4, collects: 3, shares: 2 },
}

const NOTE_STRANGER = {
  title: '随手拍的一张午饭',
  titleTruncated: false,
  publishedAtText: '2026-09-10 12:00',
  metrics: { views: 12, comments: 0, likes: 0, collects: 0, shares: 0 },
}

function syncResult(notes: unknown[]) {
  return {
    collectedAt: COLLECTED_AT,
    platform: 'xhs',
    loadedCount: notes.length,
    reachedEnd: true,
    notes,
    unrecognized: [],
    warnings: [],
  }
}

interface Fakes {
  rows: Record<string, unknown>[]
  metrics: Record<string, unknown>[]
  posts: Record<string, unknown>[]
  drafts: Map<string, { projectId: string, draftPath: string, title: string, angleSlug?: string }[]>
  service: CreatorNoteIngestService
}

function build(options: { posts?: Record<string, unknown>[], drafts?: Fakes['drafts'] } = {}): Fakes {
  const rows: Record<string, unknown>[] = []
  const metrics: Record<string, unknown>[] = []
  const posts: Record<string, unknown>[] = options.posts ?? []
  const drafts = options.drafts ?? new Map()

  const rowRepository = {
    createIfAbsent: vi.fn(async (data: Record<string, unknown>) => {
      // 唯一索引是 (userId, platform, title, publishedAtText, collectedAt)
      const duplicate = rows.some(row =>
        row.userId === data.userId
        && row.platform === data.platform
        && row.title === data.title
        && row.publishedAtText === data.publishedAtText
        && new Date(row.collectedAt as Date).getTime() === new Date(data.collectedAt as Date).getTime(),
      )
      if (duplicate)
        return null

      const doc = { id: `row-${rows.length + 1}`, ...data }
      rows.push(doc)
      return doc
    }),
    getLatestByIdentity: vi.fn(async (params: { userId: string, platform: string, title: string, publishedAtText: string }) => {
      const hits = rows.filter(row =>
        row.userId === params.userId
        && row.platform === params.platform
        && row.title === params.title
        && row.publishedAtText === params.publishedAtText,
      )
      if (hits.length === 0)
        return null

      return hits.reduce((latest, row) =>
        new Date(row.collectedAt as Date).getTime() > new Date(latest.collectedAt as Date).getTime() ? row : latest,
      )
    }),
    updatePendingById: vi.fn(async (id: string, userId: string, params: Record<string, unknown>) => {
      const row = rows.find(item => item.id === id && item.userId === userId)
      if (!row || row.matchState === CreatorNoteMatchState.MATCHED)
        return null

      Object.assign(row, params)
      return row
    }),
  }

  const metricRepository = {
    createIfAbsent: vi.fn(async (data: Record<string, unknown>) => {
      const duplicate = metrics.some(metric =>
        metric.publishedPostId === data.publishedPostId
        && new Date(metric.collectedAt as Date).getTime() === new Date(data.collectedAt as Date).getTime(),
      )
      if (duplicate)
        return null

      const doc = { id: `metric-${metrics.length + 1}`, ...data }
      metrics.push(doc)
      return doc
    }),
  }

  const publishedPostRepository = {
    getByIdAndUserId: vi.fn(async (id: string) => posts.find(post => post.id === id) ?? null),
    listByPlatformAndTitleInMinute: vi.fn(async (params: { title: string, minuteStart: Date, minuteEnd: Date }) =>
      posts.filter((post) => {
        const snapshot = post.snapshot as { title: string }
        if (snapshot.title !== params.title || !post.publishedAt)
          return false

        const at = new Date(post.publishedAt as string).getTime()
        return at >= params.minuteStart.getTime() && at < params.minuteEnd.getTime()
      }),
    ),
    listByPlatformAndTitlePrefix: vi.fn(async (params: { titlePrefix: string }) =>
      posts.filter(post => (post.snapshot as { title: string }).title.startsWith(params.titlePrefix)),
    ),
    create: vi.fn(async (data: Record<string, unknown>) => {
      const doc = { id: `post-${posts.length + 1}`, ...data }
      posts.push(doc)
      return doc
    }),
  }

  const projectRepository = {
    getById: vi.fn(async (id: string) => ({ id, dirName: `dir-${id}` })),
  }
  const angleRepository = {
    getBySlug: vi.fn(async (_projectId: string, slug: string) => ({ id: `angle-${slug}` })),
  }
  const draftSnapshotService = {
    read: vi.fn(async (_dirName: string, draftPath: string) => {
      const ref = [...drafts.values()].flat().find(item => item.draftPath === draftPath)
      return {
        draftPath,
        snapshot: { title: ref?.title ?? '', body: '正文', topics: [], mediaUrls: [] },
        angleSlug: ref?.angleSlug,
        skippedMedia: [],
        bodyFallback: false,
        mediaDeclared: false,
      }
    }),
  }
  const draftTitleIndexService = {
    buildByUserId: vi.fn(async () => drafts),
  }

  const matcher = new CreatorNoteMatcherService(
    publishedPostRepository as never,
    projectRepository as never,
    angleRepository as never,
    draftSnapshotService as never,
    draftTitleIndexService as never,
  )

  const service = new CreatorNoteIngestService(
    rowRepository as never,
    metricRepository as never,
    publishedPostRepository as never,
    matcher,
  )

  return { rows, metrics, posts, drafts, service }
}

function ingest(fakes: Fakes, notes: unknown[], at: string = COLLECTED_AT) {
  return fakes.service.ingest({
    userId: 'user-1',
    userType: UserType.User,
    executionTaskId: 'task-1',
    accountId: 'acc-1',
    result: { ...syncResult(notes), collectedAt: at },
  })
}

/** 三小时后的下一轮采集 */
const NEXT_COLLECTED_AT = '2026-09-21T05:00:00.000Z'

describe('采集结果入库', () => {
  let knownPost: Record<string, unknown>

  beforeEach(() => {
    knownPost = {
      id: 'post-known',
      userId: 'user-1',
      projectId: 'proj-1',
      angleId: 'angle-1',
      platform: 'xhs',
      snapshot: { title: NOTE_KNOWN.title },
      // 卡片上写的是 08:28（东八区），我们这边登记的是带秒的 UTC
      publishedAt: '2026-09-18T00:28:13.000Z',
    }
  })

  it('规则 1：标题加同一分钟命中已知帖子，归属并写一条快照', async () => {
    const fakes = build({ posts: [knownPost] })

    const outcome = await ingest(fakes, [NOTE_KNOWN])

    expect(outcome.matched).toBe(1)
    expect(fakes.rows[0]!.matchState).toBe(CreatorNoteMatchState.MATCHED)
    expect(fakes.rows[0]!.matchedPublishedPostId).toBe('post-known')
    expect(fakes.metrics).toHaveLength(1)
    expect(fakes.metrics[0]!.projectId).toBe('proj-1')
    expect(fakes.metrics[0]!.angleId).toBe('angle-1')
  })

  it('指标按名字存，赞和评论不会对调', async () => {
    const fakes = build({ posts: [knownPost] })

    await ingest(fakes, [NOTE_KNOWN])

    // 实测这一条是 浏览 3030 / 评论 9 / 点赞 1。按位置读会把后两个换过来
    expect(fakes.rows[0]!.metrics).toEqual({
      views: 3030,
      comments: 9,
      likes: 1,
      collects: 0,
      shares: 0,
    })
  })

  it('规则 2：已知帖子里没有，但草稿标题对得上，自动建一条 discovered 的发布记录', async () => {
    const drafts = new Map([[
      NOTE_FROM_DRAFT.title.toLowerCase(),
      [{ projectId: 'proj-1', draftPath: 'drafts/calendar', title: NOTE_FROM_DRAFT.title, angleSlug: 'pregnancy' }],
    ]])
    const fakes = build({ drafts })

    const outcome = await ingest(fakes, [NOTE_FROM_DRAFT])

    expect(outcome.matched).toBe(1)
    const created = fakes.posts[0]!
    expect(created.source).toBe(PublishedPostSource.DISCOVERED)
    expect(created.projectId).toBe('proj-1')
    expect(created.angleId).toBe('angle-pregnancy')
    // 这条帖子本来就已经在平台上了，记成 pending 会在发布页多出一张「等你去发」的卡片
    expect(created.publishStatus).toBe('published')
  })

  /**
   * 65 条帖子里只有 3 条属于这个项目。给 65 条全建发布记录的话，
   * 按方向聚合出来的数全是噪音，而且看不出哪些是真的。
   */
  it('两条规则都没命中的落成未归属，不给它建发布记录', async () => {
    const fakes = build()

    const outcome = await ingest(fakes, [NOTE_STRANGER])

    expect(outcome.unmatched).toBe(1)
    expect(fakes.rows[0]!.matchState).toBe(CreatorNoteMatchState.UNMATCHED)
    expect(fakes.posts).toHaveLength(0)
    // 未归属的行不写快照：快照表是按方向聚合用的，进去只会是噪音
    expect(fakes.metrics).toHaveLength(0)
  })

  it('标题被截断、前缀撞上多条：标成待定，两条都不选，数据照样存着', async () => {
    const posts = [
      { id: 'post-a', userId: 'user-1', projectId: 'proj-1', platform: 'xhs', snapshot: { title: '孕期日历上线了' } },
      { id: 'post-b', userId: 'user-1', projectId: 'proj-1', platform: 'xhs', snapshot: { title: '孕期日历改版说明' } },
    ]
    const fakes = build({ posts })

    const outcome = await ingest(fakes, [{
      title: '孕期日历…',
      titleTruncated: true,
      publishedAtText: '2026-09-17 15:56',
      metrics: { views: 99, comments: 3, likes: 3, collects: 1, shares: 1 },
    }])

    expect(outcome.ambiguous).toBe(1)
    expect(fakes.rows[0]!.matchState).toBe(CreatorNoteMatchState.AMBIGUOUS)
    expect(fakes.rows[0]!.matchCandidates).toEqual(['post-a', 'post-b'])
    expect(fakes.rows[0]!.metrics).toMatchObject({ views: 99 })
    expect(fakes.metrics).toHaveLength(0)
  })

  it('标题没被截断时前缀只是兜底，不会把更长的标题算进来', async () => {
    const posts = [
      { id: 'post-long', userId: 'user-1', projectId: 'proj-1', platform: 'xhs', snapshot: { title: '孕期日历（第二版）' } },
    ]
    const fakes = build({ posts })

    const outcome = await ingest(fakes, [{
      title: '孕期日历',
      titleTruncated: false,
      publishedAtText: '2026-09-17 15:56',
      metrics: { views: 5, comments: 0, likes: 0, collects: 0, shares: 0 },
    }])

    expect(outcome.unmatched).toBe(1)
  })

  it('同一次采集重复回报：不落第二份，也不多出一个折线点', async () => {
    const fakes = build({ posts: [knownPost] })

    await ingest(fakes, [NOTE_KNOWN])
    const second = await ingest(fakes, [NOTE_KNOWN])

    expect(second.insertedRows).toBe(0)
    expect(fakes.rows).toHaveLength(1)
    expect(fakes.metrics).toHaveLength(1)
  })

  /** 插件那边一条都没读到就该回报失败，走到这里说明契约被绕过了 */
  it('采集成功但一条都没有：什么都不落', async () => {
    const fakes = build({ posts: [knownPost] })

    const outcome = await ingest(fakes, [])

    expect(outcome.insertedRows).toBe(0)
    expect(fakes.rows).toHaveLength(0)
  })

  it('结果结构对不上（字段名写错、类型不对）就整批不落，不会把指标静默存成 0', async () => {
    const fakes = build({ posts: [knownPost] })

    const outcome = await fakes.service.ingest({
      userId: 'user-1',
      userType: UserType.User,
      executionTaskId: 'task-1',
      result: { collectedAt: COLLECTED_AT, platform: 'xhs' },
    })

    expect(outcome.insertedRows).toBe(0)
    expect(fakes.rows).toHaveLength(0)
  })

  it('时间解析不出来的行照样落地，只是没有 publishedAt，归不了属', async () => {
    const fakes = build({ posts: [knownPost] })

    const outcome = await ingest(fakes, [{ ...NOTE_KNOWN, publishedAtText: '昨天 08:28' }])

    expect(outcome.insertedRows).toBe(1)
    expect(fakes.rows[0]!.publishedAt).toBeUndefined()
    expect(fakes.rows[0]!.publishedAtText).toBe('昨天 08:28')
  })

  it('归不了属的帖子每轮只占一行：第二次采集刷新它的数字，不再多出一行', async () => {
    const fakes = build({ posts: [knownPost] })

    await ingest(fakes, [NOTE_STRANGER])
    const outcome = await ingest(
      fakes,
      [{ ...NOTE_STRANGER, metrics: { ...NOTE_STRANGER.metrics, views: 99 } }],
      NEXT_COLLECTED_AT,
    )

    // 一个号里 60 多条帖子不属于任何项目，每 3 小时插一遍的话一周就没法看了
    expect(fakes.rows).toHaveLength(1)
    expect(outcome.insertedRows).toBe(0)
    expect(outcome.refreshedRows).toBe(1)
    expect((fakes.rows[0]!.metrics as { views: number }).views).toBe(99)
    expect(new Date(fakes.rows[0]!.collectedAt as Date).toISOString()).toBe(NEXT_COLLECTED_AT)
  })

  it('人工认领过的帖子，下一轮采集照旧归在那条记录上，不会退回未归属', async () => {
    const fakes = build({ posts: [knownPost] })

    // 平台标题跟我们记录里的标题对不上，所以两条规则都命中不了——认领本来就是为了这种情况
    await ingest(fakes, [NOTE_STRANGER])
    fakes.rows[0]!.matchState = CreatorNoteMatchState.MATCHED
    fakes.rows[0]!.matchedPublishedPostId = 'post-known'

    const outcome = await ingest(fakes, [NOTE_STRANGER], NEXT_COLLECTED_AT)

    expect(outcome.matched).toBe(1)
    expect(outcome.unmatched).toBe(0)
    expect(fakes.rows[1]!.matchedPublishedPostId).toBe('post-known')
    // 认领时补的那个点之后，这一轮该接上第二个点
    expect(fakes.metrics).toHaveLength(1)
    expect(fakes.metrics[0]!.publishedPostId).toBe('post-known')
  })

  it('原先归不了属的行，等发布记录出现后下一轮就地转成已归属并补上快照', async () => {
    const fakes = build({ posts: [] })

    await ingest(fakes, [NOTE_KNOWN])
    expect(fakes.rows[0]!.matchState).toBe(CreatorNoteMatchState.UNMATCHED)

    fakes.posts.push(knownPost)
    const outcome = await ingest(fakes, [NOTE_KNOWN], NEXT_COLLECTED_AT)

    expect(outcome.matched).toBe(1)
    expect(fakes.rows).toHaveLength(2)
    expect(fakes.metrics).toHaveLength(1)
    expect(fakes.metrics[0]!.publishedPostId).toBe('post-known')
  })
})
