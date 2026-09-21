import type { FileNode } from '@/api/projects/project-file.types'
import { describe, expect, it } from 'vitest'
import { PROJECT_FILE_SEGMENT_MAX_LENGTH } from '@/api/projects/project-file.constants'
import { ProjectFileType } from '@/api/projects/project-file.types'
import {
  countMaterialFiles,
  findNodeByPath,
  getDirGuideKey,
  getFileExtension,
  getImageCardPathCandidates,
  getParentPath,
  getVisibleChildren,
  isImageFileName,
  isPlaceholderFileName,
  isTextFileName,
  joinMaterialPath,
  normalizeTreeResponse,
  parseFrontMatter,
  replaceNodeByPath,
  sortFileNodes,
  stripExtension,
  validateMaterialName,
} from './materials.utils'

function dir(path: string, children: FileNode[] | null = []): FileNode {
  return {
    name: path.split('/').pop() ?? '',
    path,
    type: ProjectFileType.Dir,
    size: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    children,
  }
}

function file(path: string): FileNode {
  return {
    name: path.split('/').pop() ?? '',
    path,
    type: ProjectFileType.File,
    size: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    children: null,
  }
}

describe('路径拼接与拆解', () => {
  /** 根目录用空串表示，拼出来不能带前导斜杠 */
  it('joinMaterialPath 在根目录下不加斜杠', () => {
    expect(joinMaterialPath('', 'background')).toBe('background')
    expect(joinMaterialPath('background', 'product')).toBe('background/product')
  })

  it('getParentPath 顶层返回空串', () => {
    expect(getParentPath('background')).toBe('')
    expect(getParentPath('background/product/a.md')).toBe('background/product')
  })

  it('getFileExtension 取小写扩展名', () => {
    expect(getFileExtension('Cover.PNG')).toBe('.png')
    expect(getFileExtension('README')).toBe('')
    // 隐藏文件的点在开头，不算扩展名
    expect(getFileExtension('.gitkeep')).toBe('')
    expect(getFileExtension('a.tar.gz')).toBe('.gz')
  })

  it('stripExtension 去掉扩展名', () => {
    expect(stripExtension('media/cover.png')).toBe('media/cover')
    expect(stripExtension('README')).toBe('README')
  })
})

describe('文件类型判断', () => {
  it('图片按扩展名认，大小写都认', () => {
    expect(isImageFileName('cover.png')).toBe(true)
    expect(isImageFileName('cover.JPEG')).toBe(true)
    expect(isImageFileName('cover.avif')).toBe(true)
    expect(isImageFileName('note.md')).toBe(false)
  })

  it('文本按扩展名认', () => {
    expect(isTextFileName('note.md')).toBe(true)
    expect(isTextFileName('data.csv')).toBe(true)
    expect(isTextFileName('cover.png')).toBe(false)
  })

  it('占位文件单独认', () => {
    expect(isPlaceholderFileName('.gitkeep')).toBe(true)
    expect(isPlaceholderFileName('note.md')).toBe(false)
  })
})

describe('getDirGuideKey', () => {
  it('已收录的目录给专属引导文案', () => {
    expect(getDirGuideKey('')).toBe('root')
    expect(getDirGuideKey('background/product')).toBe('backgroundProduct')
    expect(getDirGuideKey('drafts')).toBe('drafts')
  })

  it('没收录的目录退回通用引导', () => {
    expect(getDirGuideKey('background/随手建的')).toBe('generic')
  })
})

describe('sortFileNodes', () => {
  it('目录在前、文件在后，同类按名字排', () => {
    const sorted = sortFileNodes([file('b.md'), dir('z-dir'), file('a.md'), dir('a-dir')])
    expect(sorted.map(node => node.path)).toEqual(['a-dir', 'z-dir', 'a.md', 'b.md'])
  })

  /** 排序不能改原数组，调用方还拿着它渲染 */
  it('不改原数组', () => {
    const input = [file('b.md'), file('a.md')]
    sortFileNodes(input)
    expect(input.map(node => node.path)).toEqual(['b.md', 'a.md'])
  })
})

describe('normalizeTreeResponse', () => {
  it('服务端直接返回根节点时原样用', () => {
    const root = dir('background', [file('background/a.md')])
    expect(normalizeTreeResponse(root, 'background')).toBe(root)
  })

  /** 有的接口只给子节点数组，页面得自己补一个根，不然整棵树渲染不出来 */
  it('服务端只给子节点数组时补出根节点', () => {
    const normalized = normalizeTreeResponse([file('background/a.md')], 'background')
    expect(normalized?.type).toBe(ProjectFileType.Dir)
    expect(normalized?.path).toBe('background')
    expect(normalized?.name).toBe('background')
    expect(normalized?.children).toHaveLength(1)
  })

  it('根路径是空串时补出来的根也叫空串', () => {
    expect(normalizeTreeResponse([], '')?.name).toBe('')
  })

  it('没数据返回 null', () => {
    expect(normalizeTreeResponse(null, '')).toBeNull()
    expect(normalizeTreeResponse(undefined, '')).toBeNull()
  })
})

describe('findNodeByPath', () => {
  const tree = dir('', [
    dir('background', [dir('background/product', [file('background/product/a.md')])]),
    dir('media', [file('media/cover.png')]),
  ])

  it('按路径找到节点', () => {
    expect(findNodeByPath(tree, 'background/product/a.md')?.name).toBe('a.md')
    expect(findNodeByPath(tree, 'media')?.type).toBe(ProjectFileType.Dir)
    expect(findNodeByPath(tree, '')).toBe(tree)
  })

  it('找不到返回 null', () => {
    expect(findNodeByPath(tree, 'background/不存在.md')).toBeNull()
    expect(findNodeByPath(null, 'anything')).toBeNull()
    expect(findNodeByPath(dir('a', null), 'a/b')).toBeNull()
  })

  /** 只往可能包含目标的分支下钻：`media2` 不是 `media` 的前缀目录 */
  it('前缀相近的兄弟目录不会被误认', () => {
    const siblings = dir('', [dir('media', [file('media/a.png')]), dir('media2', [file('media2/b.png')])])
    expect(findNodeByPath(siblings, 'media2/b.png')?.name).toBe('b.png')
  })
})

describe('replaceNodeByPath', () => {
  it('替换指定节点并返回新树，原树不动', () => {
    const tree = dir('', [dir('media', [file('media/cover.png')])])
    const next = replaceNodeByPath(tree, 'media', node => ({ ...node, children: [] }))

    expect(next).not.toBe(tree)
    expect(findNodeByPath(next, 'media')?.children).toEqual([])
    expect(findNodeByPath(tree, 'media/cover.png')).not.toBeNull()
  })

  it('替换根节点', () => {
    const tree = dir('', [])
    expect(replaceNodeByPath(tree, '', () => file('替换了')).name).toBe('替换了')
  })

  it('叶子节点没有 children 时原样返回', () => {
    const leaf = file('a.md')
    expect(replaceNodeByPath(leaf, '不存在', node => node)).toBe(leaf)
  })
})

describe('countMaterialFiles', () => {
  it('递归数文件，跳过占位文件', () => {
    const tree = dir('', [
      dir('background', [file('background/a.md'), file('background/.gitkeep')]),
      dir('media', [file('media/cover.png')]),
      dir('empty', null),
    ])

    expect(countMaterialFiles(tree)).toBe(2)
  })

  it('空节点算 0', () => {
    expect(countMaterialFiles(null)).toBe(0)
    expect(countMaterialFiles(file('.gitkeep'))).toBe(0)
    expect(countMaterialFiles(file('a.md'))).toBe(1)
  })
})

describe('getVisibleChildren', () => {
  it('排掉占位文件并排好序', () => {
    const node = dir('background', [file('background/b.md'), file('background/.gitkeep'), dir('background/sub')])
    expect(getVisibleChildren(node).map(child => child.name)).toEqual(['sub', 'b.md'])
  })

  it('没有子节点时给空数组', () => {
    expect(getVisibleChildren(null)).toEqual([])
    expect(getVisibleChildren(dir('a', null))).toEqual([])
  })
})

describe('parseFrontMatter', () => {
  it('解析一层 key: value', () => {
    const content = '---\nossUrl: https://oss.example/a.png\nalt: 封面\n---\n正文'
    expect(parseFrontMatter(content)).toEqual({ ossUrl: 'https://oss.example/a.png', alt: '封面' })
  })

  it('去掉值两头的引号', () => {
    expect(parseFrontMatter('---\nname: "带引号"\n---\n')).toEqual({ name: '带引号' })
    expect(parseFrontMatter('---\nname: \'单引号\'\n---\n')).toEqual({ name: '单引号' })
  })

  /** Windows 上编辑过的名片是 CRLF，不处理会把每个值都带上一个 \r */
  it('cRLF 换行也认', () => {
    expect(parseFrontMatter('---\r\nname: 张三\r\n---\r\n正文')).toEqual({ name: '张三' })
  })

  it('没有 front matter 或没闭合时返回空对象', () => {
    expect(parseFrontMatter('正文开头')).toEqual({})
    expect(parseFrontMatter('---\nname: 张三\n')).toEqual({})
  })

  it('不是 key: value 的行跳过', () => {
    expect(parseFrontMatter('---\n一行随手写的\n: 没有键\nname: 张三\n---\n')).toEqual({ name: '张三' })
  })
})

describe('getImageCardPathCandidates', () => {
  /** 契约写的是「同名加 .md」，两种理解都得试，不然名片明明在也认不出来 */
  it('两种理解都给出来', () => {
    expect(getImageCardPathCandidates('media/cover.png')).toEqual(['media/cover.png.md', 'media/cover.md'])
  })

  it('本来就没有扩展名时只有一种', () => {
    expect(getImageCardPathCandidates('media/cover')).toEqual(['media/cover.md'])
  })
})

describe('validateMaterialName', () => {
  it('普通名字放行', () => {
    expect(validateMaterialName('产品说明.md')).toBeNull()
    expect(validateMaterialName('  trimmed  ')).toBeNull()
  })

  it('空名字要求先填', () => {
    expect(validateMaterialName('')).toBe('materials.nameError.required')
    expect(validateMaterialName('   ')).toBe('materials.nameError.required')
  })

  /** `.` 和 `..` 放进去就是往项目目录外面走 */
  it('单独的点和两点拒绝', () => {
    expect(validateMaterialName('.')).toBe('materials.nameError.dots')
    expect(validateMaterialName('..')).toBe('materials.nameError.dots')
  })

  it('路径分隔符和控制字符拒绝', () => {
    expect(validateMaterialName('a/b')).toBe('materials.nameError.charset')
    expect(validateMaterialName('a\\b')).toBe('materials.nameError.charset')
    expect(validateMaterialName('a\u0000b')).toBe('materials.nameError.charset')
  })

  it('超长拒绝', () => {
    expect(validateMaterialName('a'.repeat(PROJECT_FILE_SEGMENT_MAX_LENGTH + 1))).toBe('materials.nameError.tooLong')
    expect(validateMaterialName('a'.repeat(PROJECT_FILE_SEGMENT_MAX_LENGTH))).toBeNull()
  })
})
