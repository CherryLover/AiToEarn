/**
 * 按标题找草稿：扫所有在用项目的 drafts/，按归一化后的标题归组。
 * 这是整套采集能自动归属的关键，所以读不了的草稿只能跳过，不能让整次匹配失败。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftTitleIndexService, normalizeTitle, toTitlePrefix } from './draft-title-index.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/tmp/aitoearn-test-projects' } },
}))

vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

const safeReaddir = vi.fn()
vi.mock('../projects/safe-fs', () => ({
  safeReaddir: (...a: unknown[]) => safeReaddir(...a),
}))

interface BuildOptions {
  projects?: { id: string, dirName: string }[]
  /** 每个项目目录下 drafts/ 里有哪些项 */
  entries?: Record<string, string[]>
  /** draftPath -> 读出来的标题信息，缺省表示读不了 */
  titles?: Record<string, { title: string, angleSlug?: string }>
}

function build(options: BuildOptions = {}) {
  const entries = options.entries ?? {}
  const titles = options.titles ?? {}

  safeReaddir.mockImplementation(async (_root: string, segments: string[]) => {
    const names = entries[segments[0]!]
    if (!names)
      throw new Error('ENOENT')
    return names.map(name => ({ name }))
  })

  const projectRepository = {
    listByUserId: vi.fn(async () => options.projects ?? []),
  }
  const draftSnapshotService = {
    readTitle: vi.fn(async (_dirName: string, draftPath: string) => {
      const found = titles[draftPath]
      if (!found)
        throw new Error('读不了')
      return { draftPath, title: found.title, angleSlug: found.angleSlug }
    }),
  }

  const service = new DraftTitleIndexService(
    projectRepository as never,
    { root: '/tmp/aitoearn-test-projects' } as never,
    draftSnapshotService as never,
  )

  return { service, projectRepository, draftSnapshotService }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('按标题给草稿建索引', () => {
  it('把在用项目里的草稿按标题归组，方向一并带出来', async () => {
    const { service, projectRepository } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }],
      entries: { 'forty-weeks': ['20260901-xhs-pain'] },
      titles: { 'drafts/20260901-xhs-pain': { title: '孕晚期焦虑', angleSlug: 'pain-point' } },
    })

    const index = await service.buildByUserId('user-1')

    expect(projectRepository.listByUserId).toHaveBeenCalledWith('user-1', 'active')
    expect(index.get('孕晚期焦虑')).toEqual([{
      projectId: 'p1',
      draftPath: 'drafts/20260901-xhs-pain',
      title: '孕晚期焦虑',
      angleSlug: 'pain-point',
    }])
  })

  /** 同名草稿必须都留着：后面靠方向和发布时间再挑，这里丢一条就等于永远匹配不上 */
  it('同名草稿归到同一个键下，一条都不丢', async () => {
    const { service } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }, { id: 'p2', dirName: 'other' }],
      entries: { 'forty-weeks': ['a'], 'other': ['b'] },
      titles: {
        'drafts/a': { title: '孕晚期焦虑' },
        'drafts/b': { title: '孕晚期焦虑' },
      },
    })

    const index = await service.buildByUserId('user-1')

    expect(index.get('孕晚期焦虑')).toHaveLength(2)
  })

  /** 项目还没建 drafts/ 是常态，不该当成错误 */
  it('没有 drafts/ 的项目直接跳过', async () => {
    const { service } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }],
      entries: {},
    })

    const index = await service.buildByUserId('user-1')

    expect(index.size).toBe(0)
  })

  it('读不了的草稿只是匹配不上，不影响其它草稿', async () => {
    const { service } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }],
      entries: { 'forty-weeks': ['broken', 'good'] },
      titles: { 'drafts/good': { title: '孕晚期焦虑' } },
    })

    const index = await service.buildByUserId('user-1')

    expect(index.size).toBe(1)
    expect(index.get('孕晚期焦虑')).toHaveLength(1)
  })

  it('标题是空的草稿不进索引', async () => {
    const { service } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }],
      entries: { 'forty-weeks': ['empty'] },
      titles: { 'drafts/empty': { title: '' } },
    })

    const index = await service.buildByUserId('user-1')

    expect(index.size).toBe(0)
  })

  it('标题只有空白时也不进索引', async () => {
    const { service } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }],
      entries: { 'forty-weeks': ['blank'] },
      titles: { 'drafts/blank': { title: '   ' } },
    })

    const index = await service.buildByUserId('user-1')

    expect(index.size).toBe(0)
  })

  /**
   * 扫描封顶是为了不让一次工单回报把事件循环占住：
   * 撞到上限只会让后面的草稿落进未归属，数据一条都不会丢。
   */
  it('草稿太多时扫到上限就停，已经扫到的照样返回', async () => {
    const names = Array.from({ length: 520 }, (_, index) => `d${index}`)
    const titles = Object.fromEntries(names.map(name => [`drafts/${name}`, { title: name }]))
    const { service, draftSnapshotService } = build({
      projects: [{ id: 'p1', dirName: 'forty-weeks' }],
      entries: { 'forty-weeks': names },
      titles,
    })

    const index = await service.buildByUserId('user-1')

    expect(index.size).toBe(500)
    expect(draftSnapshotService.readTitle).toHaveBeenCalledTimes(500)
  })
})

describe('标题归一化', () => {
  it('去首尾空白、连续空白压成一个、大小写不敏感', () => {
    expect(normalizeTitle('  Hello   World  ')).toBe('hello world')
  })

  it('换行和制表符也算空白', () => {
    expect(normalizeTitle('孕晚期\n\t焦虑')).toBe('孕晚期 焦虑')
  })

  /** 标点和 emoji 不动：去掉的话两条只差一个符号的帖子会静默算到同一份草稿上 */
  it('标点和 emoji 原样留着', () => {
    expect(normalizeTitle('孕晚期焦虑？😮')).toBe('孕晚期焦虑？😮')
  })
})

describe('截断标题取前缀', () => {
  it('去掉中文省略号', () => {
    expect(toTitlePrefix('孕晚期焦虑怎么办……')).toBe('孕晚期焦虑怎么办')
  })

  it('去掉英文三点以上的省略号', () => {
    expect(toTitlePrefix('how to sleep...')).toBe('how to sleep')
  })

  it('没被截断的标题原样返回', () => {
    expect(toTitlePrefix('  孕晚期焦虑  ')).toBe('孕晚期焦虑')
  })

  /** 两个点不是省略号，是句子本来就这么写的 */
  it('只有两个点时不动', () => {
    expect(toTitlePrefix('等等..')).toBe('等等..')
  })
})
