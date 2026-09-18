import { AppException, ResponseCode } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as safeFs from '../projects/safe-fs'
import { AngleFileService, buildAngleGuide, DEFAULT_ANGLE_GUIDE_BODY, parseAngleGuide } from './angle-file.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/data/projects' } },
}))

vi.mock('../projects/safe-fs', () => ({
  safeMkdir: vi.fn(async () => undefined),
  safeReadFile: vi.fn(async () => ({ content: Buffer.from(''), size: 0, updatedAt: new Date() })),
  safeReaddir: vi.fn(async () => []),
  safeRemove: vi.fn(async () => undefined),
  safeRename: vi.fn(async () => undefined),
  safeWriteFile: vi.fn(async () => ({ size: 0, updatedAt: new Date() })),
}))

const safeMkdir = vi.mocked(safeFs.safeMkdir)
const safeReadFile = vi.mocked(safeFs.safeReadFile)
const safeReaddir = vi.mocked(safeFs.safeReaddir)
const safeRemove = vi.mocked(safeFs.safeRemove)
const safeRename = vi.mocked(safeFs.safeRename)
const safeWriteFile = vi.mocked(safeFs.safeWriteFile)

const META = {
  slug: 'pain-point',
  name: '痛点切入',
  source: 'ai',
  parentSlug: null,
  status: 'candidate',
} as never

function createService() {
  return new AngleFileService({ root: '/data/projects' } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('方向指引文件 · 拼装与解析', () => {
  it('frontmatter 按契约的字段顺序写，正文跟在后面', () => {
    const text = buildAngleGuide(META, '切孕期焦虑，别卖惨。')

    expect(text).toBe([
      '---',
      'slug: pain-point',
      'name: 痛点切入',
      'source: ai',
      'parent: null',
      'status: candidate',
      '---',
      '',
      '切孕期焦虑，别卖惨。',
      '',
    ].join('\n'))
  })

  it('正文为空时写占位说明，不替人编写作指引', () => {
    expect(buildAngleGuide(META, '   ')).toContain(DEFAULT_ANGLE_GUIDE_BODY)
  })

  it('血统和来源物料都写进 frontmatter', () => {
    const text = buildAngleGuide(
      { ...META, parentSlug: 'pain-point', sourceAssetPaths: ['background/product/intro.md'] } as never,
      '正文',
    )

    expect(text).toContain('parent: pain-point')
    expect(text).toContain('background/product/intro.md')
  })

  it('写出去再读回来，元信息和血缘一个不丢', () => {
    const text = buildAngleGuide(
      {
        ...META,
        desc: '切痛点',
        parentSlug: 'root-angle',
        sourceAssetPaths: ['background/feedback/bad.md', 'background/product/intro.md'],
        promptSnapshot: 'extracting-angles / 从 background 提炼候选方向',
      } as never,
      '正文在这里',
    )
    const { meta, body } = parseAngleGuide(text)

    expect(meta).toEqual({
      slug: 'pain-point',
      name: '痛点切入',
      desc: '切痛点',
      source: 'ai',
      parentSlug: 'root-angle',
      status: 'candidate',
      sourceAssetPaths: ['background/feedback/bad.md', 'background/product/intro.md'],
      promptSnapshot: 'extracting-angles / 从 background 提炼候选方向',
    })
    expect(body).toBe('正文在这里')
  })

  it('血缘字段用和数据库一致的名字写出去，不再写旧名', () => {
    const text = buildAngleGuide(
      { ...META, sourceAssetPaths: ['background/a.md'], promptSnapshot: '提示词' } as never,
      '正文',
    )

    expect(text).toContain('sourceAssetPaths:')
    expect(text).toContain('promptSnapshot: 提示词')
    expect(text).not.toContain('sourceAssets:')
    expect(text).not.toMatch(/^prompt:/m)
  })

  it('旧格式文件读出来再写回去，血缘不丢（只是换成标准字段名）', () => {
    const old = [
      '---',
      'slug: pain-point',
      'name: 痛点切入',
      'source: ai',
      'parent: null',
      'status: candidate',
      'sourceAssets: background/a.md, background/b.md',
      'prompt: 老格式里的提示词',
      '---',
      '',
      '正文',
      '',
    ].join('\n')

    const first = parseAngleGuide(old)
    const rewritten = buildAngleGuide({ ...META, ...first.meta } as never, first.body)
    const second = parseAngleGuide(rewritten)

    expect(second.meta).toEqual(first.meta)
    expect(second.meta.sourceAssetPaths).toEqual(['background/a.md', 'background/b.md'])
    expect(second.meta.promptSnapshot).toBe('老格式里的提示词')
    expect(second.body).toBe('正文')
  })

  it('没有 frontmatter：整篇都当正文，不报错', () => {
    const { meta, body } = parseAngleGuide('这是 AI 直接写的一段话')

    expect(meta).toEqual({
      slug: undefined,
      name: undefined,
      desc: undefined,
      source: undefined,
      parentSlug: undefined,
      status: undefined,
      sourceAssetPaths: undefined,
      promptSnapshot: undefined,
    })
    expect(body).toBe('这是 AI 直接写的一段话')
  })

  it('frontmatter 有但坏了：报格式不合法', () => {
    expect(() => parseAngleGuide('---\nname: "没收尾\n---\n正文\n'))
      .toThrowError(expect.objectContaining({ code: ResponseCode.AngleFileInvalid }))
  })

  it('来源物料写成一行逗号分隔也认', () => {
    const { meta } = parseAngleGuide('---\nsourceAssets: a.md, b.md\n---\n正文\n')
    expect(meta.sourceAssetPaths).toEqual(['a.md', 'b.md'])
  })
})

describe('方向指引文件 · 落盘', () => {
  it('写文件落在 angles/<slug>.md，目录不在先补出来', async () => {
    await createService().write('fortyweeks', META, '正文')

    expect(safeMkdir).toHaveBeenCalledWith('/data/projects', ['fortyweeks', 'angles'], { existOk: true })
    expect(safeWriteFile).toHaveBeenCalledWith(
      '/data/projects',
      ['fortyweeks', 'angles', 'pain-point.md'],
      expect.any(Buffer),
    )
  })

  it('调用方没带血缘时，从原文件里捞回来，不把 AI 写的提示词抹掉', async () => {
    safeReadFile.mockResolvedValueOnce({
      content: Buffer.from([
        '---',
        'slug: pain-point',
        'name: 痛点切入',
        'source: ai',
        'parent: null',
        'status: candidate',
        'sourceAssetPaths:',
        '  - background/feedback/bad.md',
        'promptSnapshot: 提炼时用的提示词',
        '---',
        '',
        '老正文',
        '',
      ].join('\n'), 'utf8'),
      size: 0,
      updatedAt: new Date(),
    } as never)

    await createService().write('fortyweeks', { ...META, name: '改过的名字' } as never, '新正文')

    const written = (safeWriteFile.mock.calls[0][2] as Buffer).toString('utf8')
    expect(written).toContain('promptSnapshot: 提炼时用的提示词')
    expect(written).toContain('background/feedback/bad.md')
    expect(written).toContain('name: 改过的名字')
    expect(written).toContain('新正文')
  })

  it('调用方带了血缘就以调用方为准', async () => {
    safeReadFile.mockResolvedValueOnce({
      content: Buffer.from('---\npromptSnapshot: 文件里的旧提示词\n---\n老正文\n', 'utf8'),
      size: 0,
      updatedAt: new Date(),
    } as never)

    await createService().write(
      'fortyweeks',
      { ...META, sourceAssetPaths: ['background/new.md'], promptSnapshot: '调用方的提示词' } as never,
      '正文',
    )

    const written = (safeWriteFile.mock.calls[0][2] as Buffer).toString('utf8')
    expect(written).toContain('promptSnapshot: 调用方的提示词')
    expect(written).not.toContain('文件里的旧提示词')
  })

  it('原文件读不到（新建方向）也照常写，不因此失败', async () => {
    safeReadFile.mockRejectedValueOnce(new AppException(ResponseCode.ProjectFileNotFound))

    await expect(createService().write('fortyweeks', META, '正文')).resolves.toBeUndefined()
    expect(safeWriteFile).toHaveBeenCalled()
  })

  it('写失败统一报方向文件写入失败', async () => {
    safeWriteFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(createService().write('fortyweeks', META, '正文'))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileWriteFailed })
  })

  it('正文超过单文件上限直接拒绝', async () => {
    await expect(createService().write('fortyweeks', META, 'x'.repeat(1024 * 1024 + 1)))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectFileTooLarge })

    expect(safeWriteFile).not.toHaveBeenCalled()
  })

  it('改名失败报改名失败，调用方才知道要回滚数据库', async () => {
    safeRename.mockRejectedValueOnce(new Error('EXDEV'))

    await expect(createService().rename('fortyweeks', 'pain-point', 'pain-point-deep'))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileRenameFailed })

    expect(safeRename).toHaveBeenCalledWith(
      '/data/projects',
      ['fortyweeks', 'angles', 'pain-point.md'],
      ['fortyweeks', 'angles', 'pain-point-deep.md'],
    )
  })

  it('删除：文件本来就不在不算失败', async () => {
    safeRemove.mockRejectedValueOnce(new AppException(ResponseCode.ProjectFileNotFound))

    await expect(createService().remove('fortyweeks', 'pain-point')).resolves.toBeUndefined()
  })

  it('删除：真删不掉要报出来，不能假装删了', async () => {
    safeRemove.mockRejectedValueOnce(new Error('EPERM'))

    await expect(createService().remove('fortyweeks', 'pain-point'))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileDeleteFailed })
  })

  it('列 slug：只认 .md，跳过目录和不合规的文件名', async () => {
    safeReaddir.mockResolvedValueOnce([
      { name: 'pain-point.md', relPath: 'angles/pain-point.md', type: 'file', size: 10, updatedAt: new Date() },
      { name: 'Bad_Name.md', relPath: 'angles/Bad_Name.md', type: 'file', size: 10, updatedAt: new Date() },
      { name: 'notes.txt', relPath: 'angles/notes.txt', type: 'file', size: 10, updatedAt: new Date() },
      { name: 'sub', relPath: 'angles/sub', type: 'dir', size: null, updatedAt: new Date() },
    ])

    await expect(createService().listSlugs('fortyweeks')).resolves.toEqual(['pain-point'])
  })

  it('angles 目录还不存在：返回空，不报错', async () => {
    safeReaddir.mockRejectedValueOnce(new AppException(ResponseCode.ProjectFileNotFound))

    await expect(createService().listSlugs('fortyweeks')).resolves.toEqual([])
  })

  it('读文件：文件不在报方向指引文件缺失', async () => {
    safeReadFile.mockRejectedValueOnce(new AppException(ResponseCode.ProjectFileNotFound))

    await expect(createService().read('fortyweeks', 'pain-point'))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileNotFound })
  })

  it('读正文：读不到返回 null，交给调用方兜底', async () => {
    safeReadFile.mockRejectedValueOnce(new AppException(ResponseCode.ProjectFileNotFound))

    await expect(createService().readBody('fortyweeks', 'pain-point')).resolves.toBeNull()
  })
})
