/**
 * detail 清洗。这一份和 `apps/aitoearn-server/src/core/system/readiness.sanitize.spec.ts`
 * 是同一组用例，两边的实现是副本关系，改一边必须改另一边。
 */
import { describe, expect, it } from 'vitest'
import { READINESS_DETAIL_MAX_LENGTH, sanitizeDetail } from './readiness.sanitize'

describe('sanitizeDetail', () => {
  it('把配置里的明文 Key 整串抹掉', () => {
    const detail = sanitizeDetail('upstream rejected key sk-placeholder-abcdef', ['sk-placeholder-abcdef'])

    expect(detail).not.toContain('sk-placeholder-abcdef')
    expect(detail).toContain('***')
  })

  it('上游返回体里回显的 Key 也抹掉，哪怕我们没见过它', () => {
    const detail = sanitizeDetail(
      { error: { message: 'Incorrect API key provided: sk-abc123456789', type: 'invalid_request_error' } },
      [],
    )

    expect(detail).not.toContain('sk-abc123456789')
    expect(detail).toContain('invalid_request_error')
  })

  it('键值对形式的密钥只抹值，不抹键名', () => {
    const detail = sanitizeDetail('{"apiKey":"topsecretvalue","model":"demo"}', [])

    expect(detail).not.toContain('topsecretvalue')
    expect(detail).toContain('apiKey')
    expect(detail).toContain('demo')
  })

  it('authorization 头和 URL 里的账号密码都抹掉', () => {
    const detail = sanitizeDetail('request failed: Bearer abcdefghijklmn at https://user:pass@upstream.example.com/v1/messages', [])

    expect(detail).not.toContain('abcdefghijklmn')
    expect(detail).not.toContain('user:pass@')
    expect(detail).toContain('upstream.example.com')
  })

  it('过短的「明文」不参与整串替换，免得把正常文案打成马赛克', () => {
    const detail = sanitizeDetail('the model is not available', ['the'])

    expect(detail).toBe('the model is not available')
  })

  it('压掉换行并按上限截断', () => {
    const detail = sanitizeDetail(`line one\n\n${'upstream said no. '.repeat(40)}`, [])

    expect(detail).not.toContain('\n')
    expect(detail.length).toBe(READINESS_DETAIL_MAX_LENGTH + 1)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('空输入回空串，不回 undefined 或 null 字样', () => {
    expect(sanitizeDetail(null)).toBe('')
    expect(sanitizeDetail(undefined)).toBe('')
  })

  it('error 取 message', () => {
    expect(sanitizeDetail(new Error('connect ECONNREFUSED'))).toBe('connect ECONNREFUSED')
  })
})
