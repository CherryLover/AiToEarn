import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { DraftGenerationService } from './draft-generation.service'

/**
 * 这个文件在上游同步（#566）里被换成了一个空的 `export {}`，vitest 会当成
 * 「没有测试套件」直接判整个文件失败，把套件搞红。这里把它换回真的用例。
 *
 * `DraftGenerationService` 的主体要连队列、模型和对象存储；下面只测尺寸换算这一段——
 * 它是纯计算，算错了不报错，只会生成一张比例不对或者被服务端拒收的图。
 */

/** 只造壳，不注入任何依赖：尺寸换算不碰构造函数里的东西 */
function resolveSize(aspectRatio?: string, imageSize?: string): string {
  const service = Object.create(DraftGenerationService.prototype) as DraftGenerationService
  const resolve = Reflect.get(service, 'resolveOpenAIImageSize') as (a?: string, s?: string) => string
  return resolve.call(service, aspectRatio, imageSize)
}

describe('resolveOpenAIImageSize 比例换算', () => {
  it('不传比例时走 2:3 这个默认值', () => {
    expect(resolveSize()).toBe(resolveSize('2:3'))
  })

  /** 1K 的正方形有一张现成的尺寸表，不用算 */
  it('1K 正方形直接用现成尺寸', () => {
    expect(resolveSize('1:1', '1K')).toBe('1024x1024')
  })

  it('算出来的尺寸保持原比例', () => {
    for (const [ratio, expected] of [['3:2', 3 / 2], ['2:3', 2 / 3], ['16:9', 16 / 9]] as const) {
      const [width, height] = resolveSize(ratio, '1K').split('x').map(Number)
      expect(width / height).toBeCloseTo(expected, 5)
    }
  })

  /** 边长和像素总数都不能超模型的上限，超了服务端直接拒收 */
  it('长边和像素总数都不超 1K 的上限', () => {
    const [width, height] = resolveSize('16:9', '1K').split('x').map(Number)
    expect(Math.max(width, height)).toBeLessThanOrEqual(1536)
    expect(width * height).toBeLessThanOrEqual(1536 * 1024)
  })

  it('2K 和 4K 各按自己的上限算，分辨率一档比一档高', () => {
    const edge = (size: string) => Math.max(...resolveSize('16:9', size).split('x').map(Number))
    expect(edge('1K')).toBeLessThan(edge('2K'))
    expect(edge('2K')).toBeLessThan(edge('4K'))
    expect(edge('4K')).toBeLessThanOrEqual(3840)
  })

  /** 两边都得是 16 的整数倍，不然模型侧会自己四舍五入，出来的图和预期对不上 */
  it('两条边都是 16 的整数倍', () => {
    for (const ratio of ['3:2', '2:3', '16:9', '9:16', '4:3']) {
      const [width, height] = resolveSize(ratio, '2K').split('x').map(Number)
      expect(width % 16).toBe(0)
      expect(height % 16).toBe(0)
    }
  })

  it('能约分的比例先约分再算，6:4 和 3:2 是同一个结果', () => {
    expect(resolveSize('6:4', '1K')).toBe(resolveSize('3:2', '1K'))
  })
})

describe('resolveOpenAIImageSize 拒绝不合法的输入', () => {
  it('比例写法不对', () => {
    expect(() => resolveSize('16-9')).toThrow(BadRequestException)
    expect(() => resolveSize('16:9:1')).toThrow(BadRequestException)
  })

  it('比例不是正整数', () => {
    expect(() => resolveSize('0:1')).toThrow(BadRequestException)
    expect(() => resolveSize('-1:2')).toThrow(BadRequestException)
    expect(() => resolveSize('1.5:2')).toThrow(BadRequestException)
    expect(() => resolveSize('a:b')).toThrow(BadRequestException)
  })

  /** 超出 1:3 ~ 3:1 的长条图模型不支持，提前拒掉比发出去再被拒好 */
  it('比例超出 1:3 ~ 3:1', () => {
    expect(() => resolveSize('4:1')).toThrow(BadRequestException)
    expect(() => resolveSize('1:4')).toThrow(BadRequestException)
    // 边界上的两个要放行
    expect(() => resolveSize('3:1')).not.toThrow()
    expect(() => resolveSize('1:3')).not.toThrow()
  })

  it('分辨率档位不认识', () => {
    expect(() => resolveSize('1:1', '8K')).toThrow(BadRequestException)
  })
})
