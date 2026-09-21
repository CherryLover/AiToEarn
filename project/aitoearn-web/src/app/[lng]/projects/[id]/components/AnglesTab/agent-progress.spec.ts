import { describe, expect, it } from 'vitest'
import { pickProgressText, readTerminalError } from './agent-progress'

/**
 * 这一组守的是 2026-09-21 那个「AI 提炼一直转圈、一行日志都没有」的回归。
 *
 * 当时的解析只看外层 `message` 是不是字符串，而服务端发的助手消息里
 * 外层 `message` 是个对象，真正的文字在 `message.message.content[]`，
 * 于是每一条都被翻成空串。下面的分片形状全部照服务端真实发的结构写。
 */
describe('pickProgressText', () => {
  it('助手消息：文字在 message.message.content 的文本块里', () => {
    const chunk = {
      type: 'chunk',
      message: {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '正在读取素材目录' },
          ],
        },
      },
    }

    expect(pickProgressText(chunk)).toBe('正在读取素材目录')
  })

  it('工具调用块显示成工具名，人能看出它在做什么', () => {
    const chunk = {
      message: {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '先看看有哪些文件' },
            { type: 'tool_use', name: 'Read' },
          ],
        },
      },
    }

    expect(pickProgressText(chunk)).toBe('先看看有哪些文件\n· Read')
  })

  it('tool_progress 分片翻成「执行中」', () => {
    expect(pickProgressText({ message: { type: 'tool_progress', tool_name: 'Grep' } })).toBe('· Grep 执行中')
  })

  it('tool_progress 没带工具名就不显示，别往框里塞噪音', () => {
    expect(pickProgressText({ message: { type: 'tool_progress' } })).toBe('')
  })

  it('result 分片优先显示错误数组', () => {
    const chunk = { message: { type: 'result', errors: ['模型超时', ''], message: '忽略我' } }
    expect(pickProgressText(chunk)).toBe('模型超时')
  })

  it('result 分片没有错误时显示它自己的 message', () => {
    expect(pickProgressText({ message: { type: 'result', message: '提炼完成' } })).toBe('提炼完成')
  })

  it('外层 message 本身是字符串时直接用', () => {
    expect(pickProgressText({ type: 'error', message: '任务被取消' })).toBe('任务被取消')
  })

  it('content 直接是字符串的形状也认', () => {
    expect(pickProgressText({ message: { type: 'assistant', content: '一句话' } })).toBe('一句话')
  })

  it('抠不出东西时返回空串，而不是 [object Object]', () => {
    expect(pickProgressText(null)).toBe('')
    expect(pickProgressText('纯字符串')).toBe('')
    expect(pickProgressText({ type: 'keep_alive' })).toBe('')
    expect(pickProgressText({ message: { type: 'assistant', message: { content: [] } } })).toBe('')
    expect(pickProgressText({ message: { type: 'assistant', message: { content: [null, { type: 'text' }, { type: 'tool_use' }] } } })).toBe('')
  })
})

/**
 * 失败必须在分片里认出来。只靠连接关闭判断不出来：
 * 服务端把失败也发成一条普通分片，连接随后照样正常关闭，
 * 页面就会把一次失败显示成「跑完了」。
 */
describe('readTerminalError', () => {
  it('error 分片就是失败', () => {
    expect(readTerminalError({ type: 'error', message: '模型返回 500' })).toBe('模型返回 500')
  })

  it('error 分片没带文字时给个兜底说法', () => {
    expect(readTerminalError({ type: 'error' })).toBe('任务失败')
  })

  it('result 分片 subtype 不是 success 也是失败', () => {
    const chunk = { message: { type: 'result', subtype: 'error_max_turns', errors: ['轮数用光了'] } }
    expect(readTerminalError(chunk)).toBe('轮数用光了')
  })

  it('subtype 不是 success 又没带文字时，把 subtype 带出来', () => {
    expect(readTerminalError({ message: { type: 'result', subtype: 'error_max_turns' } })).toBe('任务失败（error_max_turns）')
  })

  it('正常分片不算失败', () => {
    expect(readTerminalError(null)).toBeNull()
    expect(readTerminalError({ type: 'chunk', message: { type: 'assistant' } })).toBeNull()
    expect(readTerminalError({ message: { type: 'result', subtype: 'success' } })).toBeNull()
    expect(readTerminalError({ message: { type: 'result' } })).toBeNull()
  })
})
