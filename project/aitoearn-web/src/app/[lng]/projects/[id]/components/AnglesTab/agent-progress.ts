/**
 * agent-progress - 把 Agent 任务的 SSE 分片翻成人能看的一行字
 *
 * 服务端发的分片有两层（aitoearn-ai 的 `ContentGenerationTaskChunkVo`）：
 * 外层是 `{ type, message }`，`message` 里才是 Agent SDK 的原始消息，
 * 助手说的话在 `message.message.content[]` 这一层的文本块里。
 *
 * **不能只看外层的 `message` 是不是字符串**：那样每一条助手消息都会被翻成空串，
 * 页面上就是「转着圈、一行日志都没有」——这正是 2026-09-21 报上来的现象。
 *
 * 这里全程按 unknown 解析：`api/ai` 那份 `SSEMessage` 的 type 联合里
 * 压根没有 `assistant` / `tool_progress` 这些服务端真在发的值，照它写会被类型骗过去。
 */

/** 一次工具调用显示成这样，让人知道它在读什么、写什么 */
const TOOL_PREFIX = '· '

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 助手消息的 content 是内容块数组：文本块取文本，工具块取工具名 */
function readContentBlocks(content: unknown): string {
  if (typeof content === 'string')
    return content.trim()

  if (!Array.isArray(content))
    return ''

  const parts: string[] = []
  for (const raw of content) {
    const block = asRecord(raw)
    if (!block)
      continue

    if (block.type === 'text') {
      const text = asString(block.text)
      if (text)
        parts.push(text)
      continue
    }

    if (block.type === 'tool_use') {
      const name = asString(block.name)
      if (name)
        parts.push(`${TOOL_PREFIX}${name}`)
    }
  }

  return parts.join('\n')
}

/**
 * 从一条分片里抠出能显示的文字，抠不出来返回空串。
 *
 * 抠不出来就不显示，而不是显示 `[object Object]` 或者整段 JSON：
 * 这个框是给人看进度的，塞进去的噪音会把真正有用的那几行淹掉。
 */
export function pickProgressText(chunk: unknown): string {
  const outer = asRecord(chunk)
  if (!outer)
    return ''

  // 错误分片的 message 本身就是字符串
  const direct = asString(outer.message)
  if (direct)
    return direct

  const inner = asRecord(outer.message)
  if (!inner)
    return ''

  if (inner.type === 'tool_progress') {
    const name = asString(inner.tool_name)
    return name ? `${TOOL_PREFIX}${name} 执行中` : ''
  }

  if (inner.type === 'result') {
    const errors = Array.isArray(inner.errors) ? inner.errors.map(asString).filter(Boolean) : []
    if (errors.length > 0)
      return errors.join('\n')

    return asString(inner.message)
  }

  // assistant / user：真正的内容在再下一层的 content 里
  const payload = asRecord(inner.message)
  if (payload)
    return readContentBlocks(payload.content)

  return readContentBlocks(inner.content)
}

/**
 * 这条分片是不是「任务到此为止了，而且是失败」。
 *
 * 光靠连接关闭判断不出失败：服务端把失败也发成一条普通分片，
 * 连接随后照样正常关闭，页面就会显示「跑完了」。
 */
export function readTerminalError(chunk: unknown): string | null {
  const outer = asRecord(chunk)
  if (!outer)
    return null

  if (outer.type === 'error')
    return pickProgressText(chunk) || '任务失败'

  const inner = asRecord(outer.message)
  if (inner?.type === 'result' && typeof inner.subtype === 'string' && inner.subtype !== 'success')
    return pickProgressText(chunk) || `任务失败（${inner.subtype}）`

  return null
}
