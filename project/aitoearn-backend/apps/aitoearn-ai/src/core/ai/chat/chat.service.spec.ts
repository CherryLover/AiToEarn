import { describe, expect, it } from 'vitest'
import { ChatService } from './chat.service'

/**
 * 这个文件在上游同步（#566）里被换成了一个空的 `export {}`，vitest 会当成
 * 「没有测试套件」直接判整个文件失败，把套件搞红。这里把它换回真的用例。
 *
 * `ChatService` 的主体是流式转发，依赖一大堆外部服务；下面只测两个不碰依赖的
 * 用量换算方法——它们决定计费数字，算错了不会报错，只会悄悄记错账。
 */

/** 只造壳，不注入任何依赖：下面两个方法不碰构造函数里的东西 */
function createService(): ChatService {
  return Object.create(ChatService.prototype) as ChatService
}

describe('extractGeminiTokenDetails', () => {
  const service = createService()

  it('按模态归类并累加', () => {
    const details = service.extractGeminiTokenDetails([
      { modality: 'TEXT', tokenCount: 10 },
      { modality: 'TEXT', tokenCount: 5 },
      { modality: 'IMAGE', tokenCount: 3 },
      { modality: 'AUDIO', tokenCount: 2 },
      { modality: 'VIDEO', tokenCount: 1 },
    ])

    expect(details).toEqual({ text: 15, image: 3, audio: 2, video: 1 })
  })

  /** 脏数据不能把整段用量算飞，跳过就好 */
  it('模态或数量不对的条目跳过', () => {
    const details = service.extractGeminiTokenDetails([
      { modality: 'TEXT', tokenCount: 10 },
      { modality: 'TEXT' },
      { tokenCount: 7 },
      { modality: 'TEXT', tokenCount: 0 },
      { modality: 'TEXT', tokenCount: -3 },
      { modality: 'UNKNOWN', tokenCount: 4 },
    ])

    expect(details).toEqual({ text: 10 })
  })

  it('没有数据或一条都认不出来时返回 undefined', () => {
    expect(service.extractGeminiTokenDetails(undefined)).toBeUndefined()
    expect(service.extractGeminiTokenDetails([])).toBeUndefined()
    expect(service.extractGeminiTokenDetails([{ modality: 'UNKNOWN', tokenCount: 4 }])).toBeUndefined()
  })
})

describe('buildGeminiUsage', () => {
  const service = createService()

  it('没有用量数据时全部按 0 算', () => {
    expect(service.buildGeminiUsage(undefined)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      input_token_details: { cache_read: 0 },
      output_token_details: undefined,
    })
  })

  it('没有命中缓存时输入量原样带出来', () => {
    const usage = service.buildGeminiUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      totalTokenCount: 140,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }],
      candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }],
    })

    expect(usage.input_tokens).toBe(100)
    expect(usage.output_tokens).toBe(40)
    expect(usage.total_tokens).toBe(140)
    expect(usage.input_token_details).toEqual({ text: 100, cache_read: 0 })
    expect(usage.output_token_details).toEqual({ text: 40 })
  })

  /**
   * 命中缓存的那部分要从输入量里扣掉，缓存读和普通输入单价不一样。
   * 不扣就是按全价记了一遍缓存命中的 token。
   */
  it('命中缓存的部分从输入量和文本明细里扣掉', () => {
    const usage = service.buildGeminiUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      totalTokenCount: 140,
      cachedContentTokenCount: 30,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 100 }],
    })

    expect(usage.input_tokens).toBe(70)
    expect(usage.input_token_details).toEqual({ text: 70, cache_read: 30 })
  })

  /** 服务端偶尔会给出缓存量大于总输入量的数，扣成负数会把账记反 */
  it('缓存量比输入量还大时扣到 0 为止，不会变成负数', () => {
    const usage = service.buildGeminiUsage({
      promptTokenCount: 20,
      cachedContentTokenCount: 50,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 20 }],
    })

    expect(usage.input_tokens).toBe(0)
    expect(usage.input_token_details).toEqual({ text: 0, cache_read: 50 })
  })
})
