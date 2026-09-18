import { ResponseCode } from '@yikart/common'
import { describe, expect, it } from 'vitest'
import { angleRelPath, assertAngleSlugUsable, isValidAngleSlug, normalizeAngleSlug } from './angle-slug.util'

describe('方向 slug 校验', () => {
  it('合法 slug 放行', () => {
    for (const slug of ['pain-point', 'ab1', 'a-b-c-1', 'x'.repeat(40)])
      expect(() => assertAngleSlugUsable(slug)).not.toThrow()
  })

  it('不符合命名规则的一律拒绝', () => {
    const bad = [
      'Pain-Point', // 大写
      '1pain', // 数字开头
      'ab', // 太短
      'x'.repeat(41), // 太长
      'pain-', // 连字符结尾
      'pain--point', // 连续连字符
      'pain point', // 空格
      'pain_point', // 下划线
      'pain.point', // 点
      '痛点', // 非 ASCII
    ]

    for (const slug of bad) {
      expect(() => assertAngleSlugUsable(slug), slug)
        .toThrowError(expect.objectContaining({ code: ResponseCode.AngleSlugInvalid }))
    }
  })

  it('保留字和以 _ / . 开头的名字报保留字，不报格式错', () => {
    for (const slug of ['config', 'tmp', 'node_modules', '_archived_x', '.hidden']) {
      expect(() => assertAngleSlugUsable(slug), slug)
        .toThrowError(expect.objectContaining({ code: ResponseCode.AngleSlugReserved }))
    }
  })

  it('只去首尾空白，不替用户改内容', () => {
    expect(normalizeAngleSlug('  pain-point  ')).toBe('pain-point')
    // 大小写不替他改，直接按不合法拒绝，免得他以为存进去的是自己写的那个
    expect(normalizeAngleSlug(' Pain-Point ')).toBe('Pain-Point')
    expect(isValidAngleSlug('Pain-Point')).toBe(false)
  })

  it('指引文件路径固定在 angles/ 下', () => {
    expect(angleRelPath('pain-point')).toBe('angles/pain-point.md')
  })
})
