import { AppException, ResponseCode } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as safeFs from '../projects/safe-fs'
import { DraftSnapshotService } from './draft-snapshot.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/data/projects' } },
}))

vi.mock('../projects/safe-fs', () => ({
  safeReadFile: vi.fn(async () => ({ content: Buffer.from(''), size: 0, updatedAt: new Date() })),
  safeLstat: vi.fn(),
}))

const safeReadFile = vi.mocked(safeFs.safeReadFile)
const safeLstat = vi.mocked(safeFs.safeLstat)

const DIR = 'fortyweeks'
const DRAFT = 'drafts/2026-09-18-xhs-export-friction'
/** 人手工放进来的那种：一个 .md 文件直接躺在 drafts/ 下面 */
const SINGLE_DRAFT = 'drafts/2026-09-17-小红书-备孕刷到太多攻略.md'

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

/** 假的 lstat 结果，只关心是文件还是目录 */
function entryStat(type: 'file' | 'dir' | 'other') {
  return {
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
  } as never
}

/**
 * 按「相对项目根的路径」摆好文件，读不到的路径一律按 ProjectFileNotFound 抛。
 * 目录不用单独声明：路径下面挂着文件就算目录，和磁盘上一个样。
 */
function mountFiles(files: Record<string, string>) {
  safeReadFile.mockImplementation(async (_root: string, segments: string[]) => {
    const relPath = segments.slice(1).join('/')
    const content = files[relPath]
    if (content === undefined)
      throw new AppException(ResponseCode.ProjectFileNotFound)

    return { content: Buffer.from(content, 'utf8'), size: content.length, updatedAt: new Date() }
  })

  safeLstat.mockImplementation(async (_root: string, segments: string[]) => {
    const relPath = segments.slice(1).join('/')
    if (files[relPath] !== undefined)
      return entryStat('file')

    if (Object.keys(files).some(key => key.startsWith(`${relPath}/`)))
      return entryStat('dir')

    // 和 safe-fs 一样：路径中间有一级其实是个文件时，报的是「路径不合法」而不是「不存在」
    const parts = relPath.split('/')
    for (let i = 1; i < parts.length; i++) {
      if (files[parts.slice(0, i).join('/')] !== undefined)
        throw new AppException(ResponseCode.ProjectFilePathInvalid)
    }

    throw new AppException(ResponseCode.ProjectFileNotFound)
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

/**
 * 草稿有两种摆法，形态看磁盘、不看后缀（contract-stage4「建工单时必须做的」第 1 条）。
 * 第一版只认目录版，线上用户手工放的三份单文件草稿在发布页里一份都用不了。
 */
describe('草稿快照 · 单文件草稿和目录版草稿都要认', () => {
  const SINGLE_CONTENT_MD = [
    '---',
    'title: 备孕刷到太多攻略',
    'platform: xhs',
    'topics: 备孕, 孕期记录',
    'images:',
    '  - media/home.png',
    '---',
    '',
    '手写的正文。',
    '',
  ].join('\n')

  it('单文件草稿能读出标题、正文和话题', async () => {
    mountFiles({ [SINGLE_DRAFT]: SINGLE_CONTENT_MD })

    const result = await createService().read(DIR, SINGLE_DRAFT)

    expect(result.draftPath).toBe(SINGLE_DRAFT)
    expect(result.snapshot.title).toBe('备孕刷到太多攻略')
    expect(result.snapshot.body).toBe('手写的正文。')
    expect(result.snapshot.topics).toEqual(['备孕', '孕期记录'])
    expect(result.draftPlatform).toBe('xhs')
  })

  it('单文件草稿读的就是这个文件本身，不会去拼 content.md', async () => {
    mountFiles({ [SINGLE_DRAFT]: SINGLE_CONTENT_MD })

    await createService().read(DIR, SINGLE_DRAFT)

    expect(safeReadFile).toHaveBeenCalledWith(
      '/data/projects',
      [DIR, 'drafts', '2026-09-17-小红书-备孕刷到太多攻略.md'],
      expect.any(Number),
    )
    const touched = safeReadFile.mock.calls.map(call => (call[1] as string[]).join('/'))
    expect(touched.some(item => item.endsWith('content.md'))).toBe(false)
    expect(touched.some(item => item.endsWith('meta.json'))).toBe(false)
  })

  it('单文件草稿的图片照样换成名片里的 OSS 地址', async () => {
    mountFiles({
      [SINGLE_DRAFT]: SINGLE_CONTENT_MD,
      'media/home.png.md': card('https://oss.example.com/k/home.png'),
    })

    const result = await createService().read(DIR, SINGLE_DRAFT)

    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home.png'])
    expect(result.skippedMedia).toEqual([])
  })

  it('单文件草稿没有血缘也不报错，frontmatter 里写了就用', async () => {
    mountFiles({ [SINGLE_DRAFT]: SINGLE_CONTENT_MD })

    const noLineage = await createService().read(DIR, SINGLE_DRAFT)
    expect(noLineage.angleSlug).toBeUndefined()

    mountFiles({
      [SINGLE_DRAFT]: SINGLE_CONTENT_MD.replace('platform: xhs', 'platform: xhs\nangle: ttc-overload'),
    })

    const withLineage = await createService().read(DIR, SINGLE_DRAFT)
    expect(withLineage.angleSlug).toBe('ttc-overload')
  })

  it('目录版照旧：正文在 content.md，血缘在 meta.json', async () => {
    mountFiles({
      [`${DRAFT}/content.md`]: CONTENT_MD,
      [`${DRAFT}/meta.json`]: META_JSON,
      'media/home.png.md': card('https://oss.example.com/k/home.png'),
    })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.title).toBe('导出藏得太深，四步变一步')
    expect(result.snapshot.mediaUrls).toEqual(['https://oss.example.com/k/home.png'])
    expect(result.angleSlug).toBe('export-friction')
  })

  it('形态看磁盘不看后缀：名字带 .md 的目录照样按目录版读', async () => {
    mountFiles({
      'drafts/2026-09-17-手记.md/content.md': CONTENT_MD,
      'drafts/2026-09-17-手记.md/meta.json': META_JSON,
      'media/home.png.md': card('https://oss.example.com/k/home.png'),
    })

    const result = await createService().read(DIR, 'drafts/2026-09-17-手记.md')

    expect(result.snapshot.title).toBe('导出藏得太深，四步变一步')
    expect(result.angleSlug).toBe('export-friction')
  })

  it('目录在但没有 content.md，还是报草稿不存在', async () => {
    mountFiles({ [`${DRAFT}/meta.json`]: META_JSON })

    await expect(createService().read(DIR, DRAFT)).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftNotFound,
    })
  })

  it('路径在、却既不是文件也不是目录，报的是格式不对而不是不存在', async () => {
    mountFiles({})
    safeLstat.mockResolvedValue(entryStat('other'))

    await expect(createService().read(DIR, SINGLE_DRAFT)).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftInvalid,
    })
  })

  it('拿单文件草稿当目录往下钻，报的是草稿自己的码，不漏物料那一段的 20101', async () => {
    mountFiles({ [SINGLE_DRAFT]: SINGLE_CONTENT_MD })

    await expect(createService().read(DIR, `${SINGLE_DRAFT}/content.md`)).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftPathInvalid,
    })
  })

  it('借单文件草稿的路径往 drafts/ 外面读，照样被拒', async () => {
    mountFiles({ 'background/product/intro.md': '机密' })
    const service = createService()

    await expect(service.read(DIR, '../background/product/intro.md')).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftPathInvalid,
    })
    await expect(service.read(DIR, '/etc/passwd.md')).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftPathInvalid,
    })
    // `background/product/intro.md` 会被当成 drafts/ 下的路径，读不到就是读不到
    await expect(service.read(DIR, 'background/product/intro.md')).rejects.toMatchObject({
      code: ResponseCode.PublishedPostDraftNotFound,
    })
    expect(safeReadFile).not.toHaveBeenCalled()
  })
})

/**
 * 线上那三份手写草稿的真实摆法：**没有 frontmatter**，内容靠 `## 标题` / `## 正文` / `## 话题`
 * 分段，最上面还压着一段自己记账用的清单（状态、发布时间、数据、配图、备注）。
 *
 * 整篇当正文抄下来，卡片上点「全部复制」复制出去的就是连记账带小标题的一坨，粘到小红书没法直接发。
 */
describe('草稿快照 · 没有 frontmatter 的手写草稿按小节拆', () => {
  const HAND_DRAFT = 'drafts/2026-09-18-结婚4年生出来个这.md'

  /** 照抄线上其中一份的结构 */
  const HAND_CONTENT = [
    '# 结婚 4 年生出来个这……',
    '',
    '- 状态：已发布（这条是本人手写手发的，不是生成的）',
    '- 平台 / 账号：小红书「程序杂念」',
    '- 发布时间：2026-09-18 08:28',
    '- 数据：814 看 · 1 赞 · 9 评论 · 0 收藏 · 0 分享（2026-09-18 查）',
    '- 配图：2 张（1080×2348）',
    '- 备注：三条里数据最好的一条，靠的是个人故事和反差感的标题',
    '',
    '## 标题',
    '',
    '结婚 4 年生出来个这……',
    '',
    '## 正文',
    '',
    '我们结婚已经 4 年了，一直在佛系备孕。',
    '',
    '结果小孩没生出来，先生出来个 APP！！！',
    '',
    '## 话题',
    '',
    '#怀孕 #备孕 #怀孕日记 #孕期 #生娃',
    '',
  ].join('\n')

  it('标题、正文、话题各就各位，记账那段绝不进正文', async () => {
    mountFiles({ [HAND_DRAFT]: HAND_CONTENT })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.title).toBe('结婚 4 年生出来个这……')
    expect(result.snapshot.topics).toEqual(['怀孕', '备孕', '怀孕日记', '孕期', '生娃'])
    expect(result.snapshot.body).toBe(
      '我们结婚已经 4 年了，一直在佛系备孕。\n\n结果小孩没生出来，先生出来个 APP！！！',
    )

    // 复制出去直接就能发：不带记账清单，也不带小标题
    expect(result.snapshot.body).not.toContain('状态：')
    expect(result.snapshot.body).not.toContain('数据：')
    expect(result.snapshot.body).not.toContain('配图：')
    expect(result.snapshot.body).not.toContain('## ')
    expect(result.snapshot.body).not.toContain('#怀孕')
  })

  it('话题存进快照的是词，不是带井号的原文', async () => {
    mountFiles({ [HAND_DRAFT]: HAND_CONTENT })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.topics).toHaveLength(5)
    for (const topic of result.snapshot.topics)
      expect(topic.startsWith('#')).toBe(false)
  })

  it('小节标题贴着写、后面拖个空格都要认', async () => {
    const loose = HAND_CONTENT
      .replace('## 标题', '##标题')
      .replace('## 正文', '## 正文 ')
      .replace('## 话题', '##话题 ')

    mountFiles({ [HAND_DRAFT]: loose })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.title).toBe('结婚 4 年生出来个这……')
    expect(result.snapshot.body).toBe(
      '我们结婚已经 4 年了，一直在佛系备孕。\n\n结果小孩没生出来，先生出来个 APP！！！',
    )
    expect(result.snapshot.topics).toEqual(['怀孕', '备孕', '怀孕日记', '孕期', '生娃'])
  })

  it('只认标题 / 正文 / 话题三个词，别的小节一律不处理', async () => {
    const withExtra = [
      '## 标题',
      '',
      '手写的标题',
      '',
      '## 正文',
      '',
      '要发出去的正文。',
      '',
      '## 复盘',
      '',
      '这条为什么数据好：反差感。',
      '',
      '## 话题',
      '',
      '#怀孕',
      '',
    ].join('\n')

    mountFiles({ [HAND_DRAFT]: withExtra })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.title).toBe('手写的标题')
    expect(result.snapshot.body).toBe('要发出去的正文。')
    expect(result.snapshot.topics).toEqual(['怀孕'])
  })

  it('只有一级标题、没有小节时，标题取那一行，正文照旧是整篇', async () => {
    const onlyHeading = ['# 结婚 4 年生出来个这……', '', '就是一段大白话，没有分小节。', ''].join('\n')

    mountFiles({ [HAND_DRAFT]: onlyHeading })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.title).toBe('结婚 4 年生出来个这……')
    expect(result.snapshot.body).toBe('# 结婚 4 年生出来个这……\n\n就是一段大白话，没有分小节。')
    expect(result.snapshot.topics).toEqual([])
  })

  it('标题和小节都没有的草稿退回原来的行为：整篇当正文，不报错', async () => {
    mountFiles({ [HAND_DRAFT]: '就一段话，什么标记都没有。' })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.title).toBe('')
    expect(result.snapshot.body).toBe('就一段话，什么标记都没有。')
    expect(result.snapshot.topics).toEqual([])
  })

  it('有 frontmatter 的单文件草稿走原路，兜底不插手', async () => {
    const withFront = [
      '---',
      'title: frontmatter 里写的标题',
      'topics: 备孕, 孕期记录',
      '---',
      '',
      '# 正文里的一级标题',
      '',
      '## 标题',
      '',
      '小节里写的标题',
      '',
      '## 正文',
      '',
      '小节里写的正文。',
      '',
    ].join('\n')

    mountFiles({ [HAND_DRAFT]: withFront })

    const result = await createService().read(DIR, HAND_DRAFT)

    expect(result.snapshot.title).toBe('frontmatter 里写的标题')
    expect(result.snapshot.topics).toEqual(['备孕', '孕期记录'])
  })

  it('目录版一个字都不变：content.md 写成小节的样子也照旧整篇当正文', async () => {
    mountFiles({ [`${DRAFT}/content.md`]: HAND_CONTENT })

    const result = await createService().read(DIR, DRAFT)

    expect(result.snapshot.title).toBe('')
    expect(result.snapshot.body).toBe(HAND_CONTENT.trim())
    expect(result.snapshot.topics).toEqual([])
  })
})
