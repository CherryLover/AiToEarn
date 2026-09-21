import type { Angle } from '@/api/angles/angle.types'
import { describe, expect, it } from 'vitest'
import { ANGLE_ERROR_CODE, ANGLE_SLUG_MAX_LENGTH } from '@/api/angles/angle.constants'
import { AngleSource, AngleStatus } from '@/api/angles/angle.types'
import { PROJECT_ERROR_CODE } from '@/api/projects/project.constants'
import {
  buildAngleTree,
  buildExtractAnglesPrompt,
  countAngleTree,
  getAngleErrorKey,
  groupAnglesByStatus,
  suggestChildSlug,
  validateAngleDesc,
  validateAngleName,
  validateAngleSlug,
} from './angles.utils'

function makeAngle(overrides: Partial<Angle> & Pick<Angle, 'id' | 'slug'>): Angle {
  return {
    projectId: 'p1',
    name: overrides.slug,
    desc: null,
    source: AngleSource.User,
    parentAngleId: null,
    status: AngleStatus.Candidate,
    sourceAssetPaths: null,
    promptSnapshot: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('validateAngleSlug', () => {
  it('合法 slug 放行', () => {
    expect(validateAngleSlug('pain-point')).toBeNull()
    expect(validateAngleSlug('  trimmed-slug  ')).toBeNull()
  })

  /** 拒绝顺序必须跟服务端一致，否则同一个 slug 两边说法对不上 */
  it('保留字先于字符集判定', () => {
    expect(validateAngleSlug('archived')).toBe('angles.slugError.reserved')
    expect(validateAngleSlug('TMP')).toBe('angles.slugError.reserved')
    expect(validateAngleSlug('_draft')).toBe('angles.slugError.reserved')
    expect(validateAngleSlug('.git')).toBe('angles.slugError.reserved')
  })

  it('逐条拒绝理由', () => {
    expect(validateAngleSlug('')).toBe('angles.slugError.required')
    expect(validateAngleSlug('Foo')).toBe('angles.slugError.charset')
    expect(validateAngleSlug('1abc')).toBe('angles.slugError.start')
    expect(validateAngleSlug('abc-')).toBe('angles.slugError.end')
    expect(validateAngleSlug('ab')).toBe('angles.slugError.length')
    expect(validateAngleSlug(`a${'b'.repeat(ANGLE_SLUG_MAX_LENGTH)}`)).toBe('angles.slugError.length')
    expect(validateAngleSlug('foo--bar')).toBe('angles.slugError.doubleHyphen')
  })
})

describe('validateAngleName / validateAngleDesc', () => {
  it('名字必填且不能超长', () => {
    expect(validateAngleName('孕晚期焦虑')).toBeNull()
    expect(validateAngleName('  ')).toBe('angles.nameError.required')
    expect(validateAngleName('名'.repeat(200))).toBe('angles.nameError.tooLong')
  })

  it('说明可以为空，但不能超长', () => {
    expect(validateAngleDesc('')).toBeNull()
    expect(validateAngleDesc('一句说明')).toBeNull()
    expect(validateAngleDesc('字'.repeat(1000))).toBe('angles.descError.tooLong')
  })
})

describe('getAngleErrorKey', () => {
  it('请求本身没到服务端时按网络错误处理', () => {
    expect(getAngleErrorKey(null)).toBe('error.network')
    expect(getAngleErrorKey(undefined)).toBe('error.network')
  })

  it('方向自己那一段业务码翻成 angles 文案键', () => {
    expect(getAngleErrorKey(ANGLE_ERROR_CODE.NotFound)).toBe('angles.error.notFound')
    expect(getAngleErrorKey(ANGLE_ERROR_CODE.ParentCycle)).toBe('angles.error.parentCycle')
    expect(getAngleErrorKey(ANGLE_ERROR_CODE.ExtractionFailed)).toBe('angles.error.extractionFailed')
    expect(getAngleErrorKey(ANGLE_ERROR_CODE.DraftWriteFailed)).toBe('angles.error.draftWriteFailed')
    expect(getAngleErrorKey(ANGLE_ERROR_CODE.PlatformNotSupported)).toBe('angles.error.platformNotSupported')
  })

  /** 方向页面上照样会撞到项目层的错误码，不能让它掉到「未知错误」里 */
  it('非方向段的业务码交给项目那套翻译', () => {
    expect(getAngleErrorKey(PROJECT_ERROR_CODE.Archived)).toBe('error.archived')
    expect(getAngleErrorKey(999999)).toBe('error.unknown')
  })
})

describe('buildAngleTree', () => {
  it('按 parentAngleId 组树', () => {
    const tree = buildAngleTree([
      makeAngle({ id: 'child', slug: 'child', parentAngleId: 'root', createdAt: '2026-09-02T00:00:00.000Z' }),
      makeAngle({ id: 'root', slug: 'root' }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('root')
    expect(tree[0].children.map(node => node.id)).toEqual(['child'])
  })

  it('同层按创建时间排，时间一样再按 slug', () => {
    const tree = buildAngleTree([
      makeAngle({ id: 'b', slug: 'b', createdAt: '2026-09-03T00:00:00.000Z' }),
      makeAngle({ id: 'a', slug: 'a', createdAt: '2026-09-01T00:00:00.000Z' }),
      makeAngle({ id: 'c', slug: 'c', createdAt: '2026-09-01T00:00:00.000Z' }),
    ])

    expect(tree.map(node => node.id)).toEqual(['a', 'c', 'b'])
  })

  /**
   * 血统有问题的数据也必须看得见。父方向被筛掉、自己指自己、两个互相指，
   * 这三种情况都兜到顶层，不能让方向从页面上凭空消失。
   */
  it('父方向不在列表里的当顶层', () => {
    const tree = buildAngleTree([makeAngle({ id: 'orphan', slug: 'orphan', parentAngleId: '不存在' })])
    expect(tree.map(node => node.id)).toEqual(['orphan'])
  })

  it('自己指自己的当顶层', () => {
    const tree = buildAngleTree([makeAngle({ id: 'self', slug: 'self', parentAngleId: 'self' })])
    expect(tree.map(node => node.id)).toEqual(['self'])
  })

  it('互相指成环的两个都兜到顶层，不会死循环', () => {
    const tree = buildAngleTree([
      makeAngle({ id: 'a', slug: 'a', parentAngleId: 'b' }),
      makeAngle({ id: 'b', slug: 'b', parentAngleId: 'a' }),
    ])

    expect(countAngleTree(tree)).toBe(2)
  })

  it('空列表给空树', () => {
    expect(buildAngleTree([])).toEqual([])
  })
})

describe('countAngleTree', () => {
  it('数的是整棵树上的节点，不只是顶层', () => {
    const tree = buildAngleTree([
      makeAngle({ id: 'root', slug: 'root' }),
      makeAngle({ id: 'child', slug: 'child', parentAngleId: 'root' }),
      makeAngle({ id: 'grand', slug: 'grand', parentAngleId: 'child' }),
    ])

    expect(tree).toHaveLength(1)
    expect(countAngleTree(tree)).toBe(3)
    expect(countAngleTree([])).toBe(0)
  })
})

describe('groupAnglesByStatus', () => {
  it('四个状态各自成组', () => {
    const groups = groupAnglesByStatus([
      makeAngle({ id: '1', slug: 'a', status: AngleStatus.Effective }),
      makeAngle({ id: '2', slug: 'b', status: AngleStatus.Retired }),
      makeAngle({ id: '3', slug: 'c', status: AngleStatus.Effective }),
    ])

    expect(groups[AngleStatus.Effective].map(a => a.id)).toEqual(['1', '3'])
    expect(groups[AngleStatus.Retired].map(a => a.id)).toEqual(['2'])
    expect(groups[AngleStatus.Candidate]).toEqual([])
    expect(groups[AngleStatus.Testing]).toEqual([])
  })

  /** 服务端将来加了新状态，旧页面要把它显示在候选里，而不是整条数据消失 */
  it('没见过的状态落到候选组', () => {
    const groups = groupAnglesByStatus([
      makeAngle({ id: '1', slug: 'a', status: '未来状态' as AngleStatus }),
    ])

    expect(groups[AngleStatus.Candidate].map(a => a.id)).toEqual(['1'])
  })
})

describe('suggestChildSlug', () => {
  it('父 slug 后面挂序号', () => {
    expect(suggestChildSlug('pain-point', [])).toBe('pain-point-2')
  })

  it('撞车就往后找', () => {
    expect(suggestChildSlug('pain-point', ['pain-point-2', 'pain-point-3'])).toBe('pain-point-4')
  })

  /** 截断之后不能留下尾部连字符，否则建议出来的 slug 自己都过不了校验 */
  it('父 slug 超长时截断，且截出来的仍然合法', () => {
    const suggestion = suggestChildSlug('a'.repeat(ANGLE_SLUG_MAX_LENGTH), [])
    expect(suggestion.length).toBeLessThanOrEqual(ANGLE_SLUG_MAX_LENGTH)
    expect(validateAngleSlug(suggestion)).toBeNull()
  })

  it('实在找不到就返回空串，由调用方兜底', () => {
    const taken = Array.from({ length: 98 }, (_, i) => `pain-point-${i + 2}`)
    expect(suggestChildSlug('pain-point', taken)).toBe('')
  })
})

describe('buildExtractAnglesPrompt', () => {
  it('把技能名、项目名和铁律都写进去', () => {
    const prompt = buildExtractAnglesPrompt('forty-weeks', [])

    expect(prompt).toContain('extracting-angles')
    expect(prompt).toContain('forty-weeks')
    expect(prompt).toContain('background/')
    expect(prompt).toContain('不要编')
    expect(prompt).not.toContain('已经有这些方向')
  })

  /** 已有方向要带进去，不然 AI 会把同一个方向再提一遍 */
  it('已有方向作为去重提示附在最后', () => {
    const prompt = buildExtractAnglesPrompt('forty-weeks', ['pain-point', 'budget'])
    expect(prompt).toContain('已经有这些方向，不要重复提：pain-point、budget。')
  })
})
