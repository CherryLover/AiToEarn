import type { FileNode } from '@/api/projects/project-file.types'
import { describe, expect, it } from 'vitest'
import { ProjectFileType } from '@/api/projects/project-file.types'
import {
  buildDraftPrompt,
  collectDraftImageRefs,
  collectDrafts,
  isRemoteUrl,
  parseDraftContent,
  parseDraftMeta,
  parseFrontMatter,
  parseJsonObject,
} from './drafts.utils'

function file(path: string, updatedAt = '2026-09-01T00:00:00.000Z'): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.File, size: 1, updatedAt, children: null }
}
function dir(path: string, children: FileNode[] | null, updatedAt = '2026-09-01T00:00:00.000Z'): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.Dir, size: null, updatedAt, children }
}

describe('parseFrontMatter', () => {
  it('一行一个的 key: value', () => {
    const { data, body } = parseFrontMatter('---\ntitle: 待产包清单\nplatform: xhs\n---\n正文第一行')
    expect(data).toEqual({ title: '待产包清单', platform: 'xhs' })
    expect(body).toBe('正文第一行')
  })

  it('方括号写法的列表', () => {
    const { data } = parseFrontMatter('---\ntopics: [孕期, "待产包", \'\']\n---\n')
    expect(data.topics).toEqual(['孕期', '待产包'])
  })

  it('`key:` 后面跟一串 `- xxx` 的列表', () => {
    const { data } = parseFrontMatter('---\ntopics:\n  - 孕期\n  - 待产包\nplatform: xhs\n---\n')
    expect(data.topics).toEqual(['孕期', '待产包'])
    // 列表结束之后的普通字段不能被吞进列表里
    expect(data.platform).toBe('xhs')
  })

  /** Windows 上编辑过的草稿是 CRLF，不处理会把每个值都带上一个 \r */
  it('cRLF 换行也认', () => {
    const { data, body } = parseFrontMatter('---\r\ntitle: 标题\r\n---\r\n正文')
    expect(data.title).toBe('标题')
    expect(body).toBe('正文')
  })

  /** 草稿是文件不是表，认不出来的就当没有 frontmatter，整篇当正文，不能报错 */
  it('没有或没闭合 frontmatter 时整篇当正文', () => {
    expect(parseFrontMatter('直接就是正文')).toEqual({ data: {}, body: '直接就是正文' })
    expect(parseFrontMatter('---\ntitle: 标题\n')).toEqual({ data: {}, body: '---\ntitle: 标题\n' })
  })

  it('不是 key: value 的行跳过', () => {
    const { data } = parseFrontMatter('---\n随手写的一行\n: 没有键\ntitle: 标题\n---\n')
    expect(data).toEqual({ title: '标题' })
  })
})

describe('parseDraftContent', () => {
  it('按优先级取标题，话题统一成数组', () => {
    const content = parseDraftContent('---\nname: 备用名\ntitle: 正名\ntags: 孕期, 待产包\n---\n正文')
    expect(content.title).toBe('正名')
    expect(content.topics).toEqual(['孕期', '待产包'])
    expect(content.body).toBe('正文')
  })

  it('没有 title 时退回 name', () => {
    expect(parseDraftContent('---\nname: 备用名\n---\n').title).toBe('备用名')
  })

  /** 中文顿号、逗号、空格分隔的话题都得认，人手写的什么样都有 */
  it('话题的各种分隔符都认', () => {
    expect(parseDraftContent('---\ntopics: 孕期、待产包 新生儿，喂养\n---\n').topics)
      .toEqual(['孕期', '待产包', '新生儿', '喂养'])
  })

  it('什么都没有时给空值而不是报错', () => {
    const content = parseDraftContent('只有正文')
    expect(content.title).toBe('')
    expect(content.topics).toEqual([])
    expect(content.body).toBe('只有正文')
  })
})

describe('parseJsonObject', () => {
  it('对象原样读出来', () => {
    expect(parseJsonObject('{"platform":"xhs"}')).toEqual({ platform: 'xhs' })
  })

  /** meta.json 可能被写坏或者根本不是对象，这时候当没有血缘，不能白屏 */
  it('坏 JSON、数组、字面量都当没有', () => {
    expect(parseJsonObject('{坏掉的')).toBeNull()
    expect(parseJsonObject('[1,2]')).toBeNull()
    expect(parseJsonObject('"字符串"')).toBeNull()
    expect(parseJsonObject('null')).toBeNull()
  })
})

describe('parseDraftMeta', () => {
  it('已知字段取出来，缺的留空', () => {
    const meta = parseDraftMeta({ projectName: 'forty-weeks', platform: 'xhs', sourceAssetPaths: ['background/a.md'] })
    expect(meta.projectName).toBe('forty-weeks')
    expect(meta.platform).toBe('xhs')
    expect(meta.sourceAssetPaths).toEqual(['background/a.md'])
    expect(meta.angleSlug).toBe('')
    expect(meta.extra).toEqual({})
  })

  /** 认不出来的字段原样留着，血缘面板照原样列出来，别把人写的东西吞了 */
  it('没见过的字段落进 extra', () => {
    const meta = parseDraftMeta({ 自定义: '值', 数字: 3, 开关: false, 对象: { a: 1 }, 空的: null })
    expect(meta.extra).toEqual({ 自定义: '值', 数字: '3', 开关: 'false', 对象: '{"a":1}' })
    expect(meta.extra.空的).toBeUndefined()
  })

  it('sourceAssetPaths 不是数组时当空', () => {
    expect(parseDraftMeta({ sourceAssetPaths: 'background/a.md' }).sourceAssetPaths).toEqual([])
  })
})

describe('collectDrafts', () => {
  it('一个草稿一个目录：认出 content.md 和 meta.json', () => {
    const drafts = collectDrafts(dir('drafts', [
      dir('drafts/2026-09-21-xhs-pain-point', [
        file('drafts/2026-09-21-xhs-pain-point/content.md', '2026-09-21T10:00:00.000Z'),
        file('drafts/2026-09-21-xhs-pain-point/meta.json'),
      ]),
    ]))

    expect(drafts).toHaveLength(1)
    expect(drafts[0].contentPath).toBe('drafts/2026-09-21-xhs-pain-point/content.md')
    expect(drafts[0].metaPath).toBe('drafts/2026-09-21-xhs-pain-point/meta.json')
    expect(drafts[0].updatedAt).toBe('2026-09-21T10:00:00.000Z')
  })

  /** AI 换了写法页面不能就此空白：没有 content.md 就退而认目录里第一个 .md */
  it('没有 content.md 时退而认目录里的 .md', () => {
    const drafts = collectDrafts(dir('drafts', [
      dir('drafts/a', [file('drafts/a/正文.md')]),
    ]))
    expect(drafts[0].contentPath).toBe('drafts/a/正文.md')
    expect(drafts[0].metaPath).toBe('')
  })

  it('直接躺在 drafts/ 下的单文件草稿也认', () => {
    const drafts = collectDrafts(dir('drafts', [file('drafts/随手写的.md')]))
    expect(drafts[0].name).toBe('随手写的')
    expect(drafts[0].contentPath).toBe('drafts/随手写的.md')
  })

  it('目录名以日期开头，按名字倒序即新的在前', () => {
    const drafts = collectDrafts(dir('drafts', [
      dir('drafts/2026-09-19-xhs-a', [], '2026-09-19T00:00:00.000Z'),
      dir('drafts/2026-09-21-xhs-b', [], '2026-09-21T00:00:00.000Z'),
      dir('drafts/2026-09-20-xhs-c', [], '2026-09-20T00:00:00.000Z'),
    ]))

    expect(drafts.map(item => item.name)).toEqual(['2026-09-21-xhs-b', '2026-09-20-xhs-c', '2026-09-19-xhs-a'])
  })

  it('空目录树给空列表', () => {
    expect(collectDrafts(null)).toEqual([])
    expect(collectDrafts(dir('drafts', null))).toEqual([])
  })
})

describe('isRemoteUrl', () => {
  it('只认 http/https', () => {
    expect(isRemoteUrl('https://oss.example/a.png')).toBe(true)
    expect(isRemoteUrl('HTTP://oss.example/a.png')).toBe(true)
    expect(isRemoteUrl('media/a.png')).toBe(false)
    expect(isRemoteUrl('//oss.example/a.png')).toBe(false)
  })
})

describe('collectDraftImageRefs', () => {
  const draftDir = 'drafts/2026-09-21-xhs-pain-point'

  it('meta、frontmatter、正文三个来源都看，按出现顺序去重', () => {
    const content = parseDraftContent('---\ncover: media/cover.png\n---\n![](media/a.png)\n![alt](https://oss.example/b.png)')
    const refs = collectDraftImageRefs(content, { images: ['media/meta-1.png', 'media/cover.png'] }, draftDir)

    expect(refs).toEqual([
      'media/meta-1.png',
      'media/cover.png',
      'media/a.png',
      'https://oss.example/b.png',
    ])
  })

  it('meta 里的单个字符串也认', () => {
    expect(collectDraftImageRefs(null, { cover: 'media/only.png' }, draftDir)).toEqual(['media/only.png'])
  })

  /** 草稿里写的相对路径要补成相对项目根，不然图片找不到 */
  it('相对路径补成相对项目根', () => {
    const content = parseDraftContent('![](./local.png)\n![](/media/abs.png)')
    expect(collectDraftImageRefs(content, null, draftDir)).toEqual([
      `${draftDir}/local.png`,
      'media/abs.png',
    ])
  })

  it('已经是外链或已经从项目根写起的原样保留', () => {
    const content = parseDraftContent('![](https://oss.example/a.png)\n![](media/b.png)\n![](drafts/c.png)')
    expect(collectDraftImageRefs(content, null, draftDir)).toEqual([
      'https://oss.example/a.png',
      'media/b.png',
      'drafts/c.png',
    ])
  })

  it('什么都没有时给空数组', () => {
    expect(collectDraftImageRefs(null, null, draftDir)).toEqual([])
  })
})

describe('buildDraftPrompt', () => {
  const params = {
    projectName: 'forty-weeks',
    angleSlug: 'pain-point',
    angleName: '孕晚期焦虑',
    platform: 'xhs',
  }

  it('技能名、方向、平台、落盘位置都写明', () => {
    const prompt = buildDraftPrompt(params)

    expect(prompt).toContain('drafting-post')
    expect(prompt).toContain('angles/pain-point.md')
    expect(prompt).toContain('孕晚期焦虑')
    expect(prompt).toContain('drafts/<yyyy-MM-dd>-xhs-pain-point/')
    expect(prompt).toContain('content.md')
    expect(prompt).toContain('meta.json')
    expect(prompt).toContain('事实只能来自物料')
    expect(prompt).not.toContain('补充要求')
  })

  it('补充要求非空才附上', () => {
    expect(buildDraftPrompt({ ...params, extra: '  ' })).not.toContain('补充要求')
    expect(buildDraftPrompt({ ...params, extra: '多写点数据' })).toContain('补充要求：多写点数据')
  })
})
