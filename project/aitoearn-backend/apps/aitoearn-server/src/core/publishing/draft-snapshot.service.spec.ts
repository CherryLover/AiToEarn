import { AppException, ResponseCode } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as safeFs from '../projects/safe-fs'
import { DraftSnapshotService } from './draft-snapshot.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/data/projects' } },
}))

vi.mock('../projects/safe-fs', () => ({
  safeReadFile: vi.fn(async () => ({ content: Buffer.from(''), size: 0, updatedAt: new Date() })),
}))

const safeReadFile = vi.mocked(safeFs.safeReadFile)

const DIR = 'fortyweeks'
const DRAFT = 'drafts/2026-09-18-xhs-export-friction'

const CONTENT_MD = [
  '---',
  'title: 导出藏得太深，四步变一步',
  'platform: xhs',
  'angle: export-friction',
  'topics:',
  '  - 效率工具',
  '  - 设计师日常',
  'images:',
  '  - https://oss.example.com/k/home.png',
  '---',
  '',
  '正文第一段。',
  '',
  '#效率工具 #设计师日常',
  '',
].join('\n')

const META_JSON = JSON.stringify({
  projectName: 'fortyweeks',
  angleSlug: 'export-friction',
  platform: 'xhs',
  mediaRefs: [{ file: 'media/home.png', oss: 'https://oss.example.com/k/home.png' }],
  promptSnapshot: '按方向 export-friction 生成一条小红书图文',
})

function card(oss: string): string {
  return [
    '---',
    'file: home.png',
    'type: image',
    `oss: ${oss}`,
    'size: 1024',
    '---',
    '',
    '（图片说明）',
    '',
  ].join('\n')
}

/** 按「相对项目根的路径」摆好文件，读不到的路径一律按 ProjectFileNotFound 抛 */
function mountFiles(files: Record<string, string>) {
  safeReadFile.mockImplementation(async (_root: string, segments: string[]) => {
    const relPath = segments.slice(1).join('/')
    const content = files[relPath]
    if (content === undefined)
      throw new AppException(ResponseCode.ProjectFileNotFound)

    return { content: Buffer.from(content, 'utf8'), size: content.length, updatedAt: new Date() }
  })
}

function createService() {
  return new DraftSnapshotService({ root: '/data/projects' } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('草稿快照 · 抄下点「准备发布」那一刻的内容', () => {
  it('标题、正文、话题、图片地址都抄对', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: META_JSON,
      'media/home.png.md': card('https://oss.example.com/k/home.png'),
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.draftPath).toBe(DRAFT)
    expect(result.snapshot.title).toBe('导出藏得太深，四步变一步')
    expect(result.snapshot.body).toBe('正文第一段。\n\n#效率工具 #设计师日常')
    expect(result.snapshot.topics).toEqual(['效率工具', '设计师日常'])
    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home.png'])
    expect(result.skippedMedia).toEqual([])
    expect(result.angleSlug).toBe('export-friction')
    expect(result.draftPlatform).toBe('xhs')
  })

  it('图片地址以名片里的 oss 为准，草稿里写的旧地址不算数', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: META_JSON,
      // 图片被重新传过一次，名片上是新地址
      'media/home.png.md': card('https://oss.example.com/k/home-v2.png'),
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home-v2.png'])
  })

  it('名片里没有 OSS 地址的图片跳过，并说明跳了哪些', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: META_JSON,
      // 当初传 OSS 失败，名片里 oss 是空的
      'media/home.png.md': card(''),
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.mediaUrls).toEqual([])
    expect(result.skippedMedia).toEqual([{ path: 'media/home.png', reason: 'oss_missing' }])
  })

  it('名片文件整个缺失的图片也跳过，理由跟 oss 为空分开', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: META_JSON,
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.mediaUrls).toEqual([])
    expect(result.skippedMedia).toEqual([{ path: 'media/home.png', reason: 'card_missing' }])
  })

  it('血缘文件缺失不影响发布，草稿里写的 OSS 地址照用', async () => {
    mountFiles({ [`${DRAFT}/content.md`]: CONTENT_MD })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home.png'])
    expect(result.angleSlug).toBe('export-friction')
  })

  it('血缘文件不是合法 JSON 也不拦着发，按没有处理', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: '{ 这不是 JSON',
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.title).toBe('导出藏得太深，四步变一步')
  })

  it('frontmatter 里写的是本地路径时，照样去名片里换成 OSS 地址', async () => {
    const localImages = CONTENT_MD.replace(
      '  - https://oss.example.com/k/home.png',
      '  - media/home.png',
    )

    mountFiles({
      [`${DRAFT}/content.md`]: localImages,
      'media/home.png.md': card('https://oss.example.com/k/home.png'),
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home.png'])
  })

  it('同一张图在正文和血缘里各写一遍，快照里只出现一次', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: META_JSON,
      'media/home.png.md': card('https://oss.example.com/k/home.png'),
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home.png'])
  })

  it('没有 frontmatter 的草稿整篇当正文，不报废', async () => {
    mountFiles({ [`${DRAFT}/content.md`]: '就一段话，没有 frontmatter。' })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.title).toBe('')
    expect(result.snapshot.body).toBe('就一段话，没有 frontmatter。')
  })

  it('标题和正文都空的草稿拦住，不发空帖子', async () => {
    mountFiles({ [`${DRAFT}/content.md`]: '---\nplatform: xhs\n---\n\n' })

    await expect(createService().read(DIR, DRAFT)).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftEmpty,
    })
  })

  it('草稿不存在时报草稿自己的错误码', async () => {
    mountFiles({})

    await expect(createService().read(DIR, DRAFT)).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftNotFound,
    })
  })

  it('少写 drafts/ 前缀容忍掉，但读的还是 drafts/ 下的文件', async () => {
    mountFiles({ [`${DRAFT}/content.md`]: CONTENT_MD })

    const result = await createService().read(DIR, '2026-09-18-xhs-export-friction')

    expect(result.draftPath).toBe(DRAFT)
  })

  it('想借草稿路径读 drafts/ 以外的文件，直接拒', async () => {
    mountFiles({ 'background/product/intro.md': '机密' })
    const service = createService()

    await expect(service.read(DIR, '../../etc')).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftPathInvalid,
    })
    await expect(service.read(DIR, '/etc/passwd')).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftPathInvalid,
    })
    // `background/x` 会被当成 drafts/background/x，读不到就是读不到，绝不越界
    await expect(service.read(DIR, 'background/product')).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftNotFound,
    })
  })
})
