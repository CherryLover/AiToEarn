import type { FileNode } from '@/api/projects/project-file.types'
import type { PublishSnapshot, SkippedMedia } from '@/api/publishing/publishing.types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFileType } from '@/api/projects/project-file.types'
import { PROJECT_ERROR_CODE } from '@/api/projects/project.constants'
import { POST_URL_MAX_LENGTH, PUBLISHING_ERROR_CODE } from '@/api/publishing/publishing.constants'
import { LinkStatus, PublishStatus } from '@/api/publishing/publishing.types'
import {
  buildFullCopyText,
  buildImageFileName,
  collectMediaImages,
  copyToClipboard,
  downloadImage,
  formatTopics,
  getFileBaseName,
  getLinkStatusClassName,
  getPlatformLabelKey,
  getPublishErrorKey,
  getPublishStatusClassName,
  groupSkippedMedia,
  guessPlatformFromDraftPath,
  mergeCardMedia,
  validatePostUrl,
} from './publish.utils'

function snapshot(overrides: Partial<PublishSnapshot> = {}): PublishSnapshot {
  return { title: '', body: '', topics: [], mediaUrls: [], ...overrides }
}

describe('getPublishErrorKey', () => {
  it('请求本身没到服务端时按网络错误处理', () => {
    expect(getPublishErrorKey(null)).toBe('error.network')
    expect(getPublishErrorKey(undefined)).toBe('error.network')
  })

  it('发布自己那一段业务码翻成 publishError 文案键', () => {
    expect(getPublishErrorKey(PUBLISHING_ERROR_CODE.NotFound)).toBe('publishError.notFound')
    expect(getPublishErrorKey(PUBLISHING_ERROR_CODE.DraftEmpty)).toBe('publishError.draftEmpty')
    expect(getPublishErrorKey(PUBLISHING_ERROR_CODE.AutoModeNotSupported)).toBe('publishError.autoModeNotSupported')
    expect(getPublishErrorKey(PUBLISHING_ERROR_CODE.Duplicate)).toBe('publishError.duplicate')
    expect(getPublishErrorKey(PUBLISHING_ERROR_CODE.UrlInvalid)).toBe('publishError.urlInvalid')
  })

  /** 发布页照样会撞到项目层的错误码 */
  it('非发布段的业务码交给项目那套翻译', () => {
    expect(getPublishErrorKey(PROJECT_ERROR_CODE.Archived)).toBe('error.archived')
    expect(getPublishErrorKey(999999)).toBe('error.unknown')
  })
})

describe('formatTopics', () => {
  it('统一补 #，已经带了的不重复补', () => {
    expect(formatTopics(['孕期', '#待产包'])).toBe('#孕期 #待产包')
  })

  it('空话题和空白话题都丢掉', () => {
    expect(formatTopics(['  ', '', '孕期'])).toBe('#孕期')
    expect(formatTopics([])).toBe('')
  })
})

describe('buildFullCopyText', () => {
  it('标题、正文、话题按顺序空行隔开', () => {
    const text = buildFullCopyText(snapshot({ title: '标题', body: '正文', topics: ['孕期'] }))
    expect(text).toBe('标题\n\n正文\n\n#孕期')
  })

  /** 缺哪段就跳过哪段，不能留下一串空行让人复制走 */
  it('缺的那段跳过，不留空行', () => {
    expect(buildFullCopyText(snapshot({ title: '只有标题' }))).toBe('只有标题')
    expect(buildFullCopyText(snapshot({ body: '只有正文', topics: ['孕期'] }))).toBe('只有正文\n\n#孕期')
    expect(buildFullCopyText(snapshot())).toBe('')
  })

  it('topics 缺字段也不炸', () => {
    expect(buildFullCopyText({ title: '标题', body: '', topics: undefined as unknown as string[], mediaUrls: [] })).toBe('标题')
  })
})

describe('validatePostUrl', () => {
  it('http/https 链接放行', () => {
    expect(validatePostUrl('https://www.xiaohongshu.com/explore/abc')).toBeNull()
    expect(validatePostUrl('  http://example.com/a  ')).toBeNull()
  })

  it('必填、超长、非 http 分别给出理由', () => {
    expect(validatePostUrl('')).toBe('publish.card.urlRequired')
    expect(validatePostUrl(`https://a.com/${'b'.repeat(POST_URL_MAX_LENGTH)}`)).toBe('publish.card.urlTooLong')
    expect(validatePostUrl('xhsdiscover://item/abc')).toBe('publish.card.urlInvalid')
    expect(validatePostUrl('www.example.com')).toBe('publish.card.urlInvalid')
  })
})

describe('guessPlatformFromDraftPath', () => {
  it('从 `<日期>-<平台>-<方向>` 目录名里认平台', () => {
    expect(guessPlatformFromDraftPath('drafts/2026-09-21-xhs-pain-point')).toBe('xhs')
    expect(guessPlatformFromDraftPath('drafts/2026-09-21-wxGzh-budget')).toBe('wxGzh')
  })

  it('认不出来返回空串', () => {
    expect(guessPlatformFromDraftPath('drafts/随手建的目录')).toBe('')
    expect(guessPlatformFromDraftPath('')).toBe('')
  })
})

describe('buildImageFileName', () => {
  it('从地址里取文件名', () => {
    expect(buildImageFileName('https://oss.example/a/cover.png', 0)).toBe('cover.png')
    expect(buildImageFileName('https://oss.example/a/%E5%B0%81%E9%9D%A2.png', 0)).toBe('封面.png')
  })

  /** 取不到扩展名就得补一个，不然下下来的文件系统打不开 */
  it('取不到像样的文件名时按序号补', () => {
    expect(buildImageFileName('https://oss.example/a/', 2)).toBe('image-3.jpg')
    expect(buildImageFileName('https://oss.example/abc', 0)).toBe('image-1.jpg')
    expect(buildImageFileName('%%%', 0)).toBe('image-1.jpg')
  })
})

describe('getFileBaseName', () => {
  it('取路径里的文件名，取不到就用整段', () => {
    expect(getFileBaseName('media/2026-09-18/cover.png')).toBe('cover.png')
    expect(getFileBaseName('cover.png')).toBe('cover.png')
    expect(getFileBaseName('')).toBe('')
  })
})

describe('状态徽标样式', () => {
  it('发布状态四支各不相同', () => {
    const classNames = [PublishStatus.Published, PublishStatus.Failed, PublishStatus.Publishing, PublishStatus.Pending]
      .map(getPublishStatusClassName)
    expect(new Set(classNames).size).toBe(4)
  })

  it('链接状态三支各不相同', () => {
    const classNames = [LinkStatus.Claimed, LinkStatus.ClaimFailed, LinkStatus.None].map(getLinkStatusClassName)
    expect(new Set(classNames).size).toBe(3)
  })

  /** 写死 emerald 亮色下只有 3.43:1，必须走主题变量 */
  it('不再出现写死的颜色类名', () => {
    for (const status of Object.values(PublishStatus))
      expect(getPublishStatusClassName(status)).not.toMatch(/emerald|red-\d|green-\d/)
    for (const status of Object.values(LinkStatus))
      expect(getLinkStatusClassName(status)).not.toMatch(/emerald|red-\d|green-\d/)
  })
})

describe('getPlatformLabelKey', () => {
  it('已收录的平台给文案键', () => {
    expect(getPlatformLabelKey('xhs')).toBe('drafts.platform.xhs')
  })

  it('没收录的平台返回 null 交给调用方显示原值', () => {
    expect(getPlatformLabelKey('weibo')).toBeNull()
  })
})

/**
 * 跳过原因不能合成一句话说。三种原因是三件不同的事：
 * 找不到名片 / 名片里没 OSS 地址 / 草稿里那一行路径不允许。
 * 合成「有 N 张图没有 OSS 地址」会把人往错误的方向带——
 * 路径被拒那几行跟 OSS 一点关系都没有，照着去查 OSS 永远查不出来。
 */
describe('groupSkippedMedia', () => {
  it('按原因分组计数，路径原样带上', () => {
    const groups = groupSkippedMedia([
      { path: 'media/a.png', reason: 'oss_missing' },
      { path: '../../etc/passwd', reason: 'path_not_allowed' },
      { path: 'media/b.png', reason: 'oss_missing' },
    ])

    expect(groups.map(group => group.reason)).toEqual(['path_not_allowed', 'oss_missing'])
    expect(groups[0].count).toBe(1)
    expect(groups[0].paths).toEqual(['../../etc/passwd'])
    expect(groups[1].count).toBe(2)
  })

  /** 路径被拒排最前：只有人回草稿里改那一行才有救，最该先看见 */
  it('path_not_allowed 永远排最前', () => {
    const groups = groupSkippedMedia([
      { path: 'a', reason: 'card_missing' },
      { path: 'b', reason: 'oss_missing' },
      { path: 'c', reason: 'path_not_allowed' },
    ])

    expect(groups.map(group => group.reason)).toEqual(['path_not_allowed', 'card_missing', 'oss_missing'])
  })

  /** 宁可说「不知道为什么」，也不能安给它一个现成的理由 */
  it('没见过的原因退回 unknown 文案，排在已知的后面', () => {
    const groups = groupSkippedMedia([
      { path: 'a', reason: '将来新加的原因' as SkippedMedia['reason'] },
      { path: 'b', reason: 'oss_missing' },
    ])

    expect(groups.map(group => group.reason)).toEqual(['oss_missing', '将来新加的原因'])
    expect(groups[1].messageKey).toBe('publish.skipped.unknown')
    expect(groups[0].messageKey).toBe('publish.skipped.ossMissing')
  })

  it('没有跳过的图时给空数组', () => {
    expect(groupSkippedMedia(null)).toEqual([])
    expect(groupSkippedMedia(undefined)).toEqual([])
    expect(groupSkippedMedia([])).toEqual([])
  })

  it('数组里混进空项也不炸', () => {
    const groups = groupSkippedMedia([null as unknown as SkippedMedia, { path: 'a', reason: 'oss_missing' }])
    expect(groups).toHaveLength(1)
  })
})

describe('mergeCardMedia', () => {
  it('快照的图排前面、顺序不动，挑的图接在后面', () => {
    const merged = mergeCardMedia(
      ['https://oss.example/b.png', 'https://oss.example/a.png'],
      [{ path: 'media/c.png', name: 'c.png', url: 'blob:c', ossUrl: '' }],
    )

    expect(merged.map(item => item.fileName)).toEqual(['b.png', 'a.png', 'c.png'])
    expect(merged.slice(0, 2).every(item => !item.picked)).toBe(true)
    expect(merged[2].picked).toBe(true)
    expect(merged[2].path).toBe('media/c.png')
  })

  /** 同一张图两边都有只能算一次，不然卡片上会出现两张一样的图 */
  it('挑的图的 OSS 地址已经在快照里就不重复加', () => {
    const merged = mergeCardMedia(
      ['https://oss.example/a.png'],
      [{ path: 'media/a.png', name: 'a.png', url: 'blob:a', ossUrl: 'https://oss.example/a.png' }],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0].picked).toBe(false)
  })

  it('快照里重复的地址只留一次', () => {
    const merged = mergeCardMedia(['https://oss.example/a.png', 'https://oss.example/a.png'], [])
    expect(merged).toHaveLength(1)
  })

  it('同一张图挑两次也只算一次', () => {
    const picked = { path: 'media/a.png', name: 'a.png', url: 'blob:a', ossUrl: '' }
    expect(mergeCardMedia([], [picked, picked])).toHaveLength(1)
  })
})

describe('collectMediaImages', () => {
  function file(path: string): FileNode {
    return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.File, size: 1, updatedAt: '', children: null }
  }
  function dir(path: string, children: FileNode[]): FileNode {
    return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.Dir, size: null, updatedAt: '', children }
  }

  it('递归挑出图片并按路径排序，跳过名片和占位文件', () => {
    const root = dir('media', [
      dir('media/2026-09-18', [file('media/2026-09-18/b.png'), file('media/2026-09-18/b.png.md')]),
      file('media/a.jpg'),
      file('media/.gitkeep'),
    ])

    const { files, truncated } = collectMediaImages(root, 10)
    expect(files.map(item => item.path)).toEqual(['media/2026-09-18/b.png', 'media/a.jpg'])
    expect(truncated).toBe(false)
  })

  /** 图库大起来一次全列出来页面会卡，截断之后必须说一声 */
  it('超过上限只留前面这些并标记截断', () => {
    const root = dir('media', [file('media/a.png'), file('media/b.png'), file('media/c.png')])
    const { files, truncated } = collectMediaImages(root, 2)
    expect(files.map(item => item.name)).toEqual(['a.png', 'b.png'])
    expect(truncated).toBe(true)
  })

  it('没有目录树时给空结果', () => {
    expect(collectMediaImages(null, 10)).toEqual({ files: [], truncated: false })
  })
})

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('优先走 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyToClipboard('要复制的')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('要复制的')
    vi.unstubAllGlobals()
  })

  /** 局域网自测是 http，没有 Clipboard API，必须还能复制 */
  it('没有 Clipboard API 时退回 execCommand', async () => {
    vi.stubGlobal('navigator', {})
    const execCommand = vi.fn().mockReturnValue(true)
    Reflect.set(document, 'execCommand', execCommand)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(copyToClipboard('要复制的')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    vi.unstubAllGlobals()
  })

  it('clipboard API 抛错时也退回 execCommand', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    Reflect.set(document, 'execCommand', vi.fn().mockReturnValue(true))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(copyToClipboard('要复制的')).resolves.toBe(true)
    vi.unstubAllGlobals()
  })

  it('空文本直接返回 false', async () => {
    await expect(copyToClipboard('')).resolves.toBe(false)
  })
})

describe('downloadImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('取得到图就按 blob 存，文件名能控制', async () => {
    const blob = new Blob(['x'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }))
    const createObjectURL = vi.fn().mockReturnValue('blob:local')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await expect(downloadImage('https://oss.example/a.png', 'a.png')).resolves.toBe(true)
    expect(click).toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    vi.unstubAllGlobals()
  })

  /** OSS 没开 CORS 时 fetch 会失败，得退回新标签页让人右键存，不能什么都不发生 */
  it('跨域取不到时退回新标签页打开', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('CORS')))
    const open = vi.fn()
    vi.stubGlobal('open', open)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(downloadImage('https://oss.example/a.png', 'a.png')).resolves.toBe(false)
    expect(open).toHaveBeenCalledWith('https://oss.example/a.png', '_blank', 'noopener,noreferrer')
    vi.unstubAllGlobals()
  })

  it('服务端返回非 2xx 时同样退回新标签页', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const open = vi.fn()
    vi.stubGlobal('open', open)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(downloadImage('https://oss.example/a.png', 'a.png')).resolves.toBe(false)
    expect(open).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
