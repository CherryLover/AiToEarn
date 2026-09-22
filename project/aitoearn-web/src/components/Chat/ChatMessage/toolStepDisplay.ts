/**
 * 工具调用步骤的展示口径
 *
 * Agent 干活时的工具调用（读文件、写文件、列待办…）原本只显示一个工具名加一段原始 JSON，
 * 看不出它到底动了什么。这里把常用的几个翻成人话，剩下的保持原样。
 *
 * 纯函数，不碰 React，也不做翻译：返回文案键和参数，由组件去 t()。
 */

/** 待办项，对应 TodoWrite 的入参 */
export interface ToolTodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface ToolStepDisplay {
  /** 动作的文案键，落在 chat 命名空间下的 `toolAction.*`；认不出来的工具为 null */
  actionKey: string | null
  /** 动作的宾语：文件路径、匹配式、命令等。没有就是空串 */
  target: string
  /** TodoWrite 专用：解析出来的待办清单 */
  todos?: ToolTodoItem[]
}

/** mcp 工具名带一长串前缀，界面上只留最后那一段 */
export function formatToolName(name: string): string {
  return name.replace(/^mcp__\w+__/, '')
}

/**
 * 把工具入参里的路径收成项目内的相对路径。
 *
 * 服务器上的绝对路径不能显示给用户：既没必要暴露目录结构，那串东西对用户也毫无意义。
 * 知道项目名就从项目目录那一段之后开始截；不知道就退而求其次，只留最后两段。
 */
export function toProjectRelativePath(raw: string, projectName?: string): string {
  const path = raw.trim().replace(/\\/g, '/')
  if (!path)
    return ''

  if (projectName) {
    // 匹配 /<projectName>/ 这一段，取它后面的部分
    const marker = `/${projectName}/`
    const at = path.indexOf(marker)
    if (at >= 0)
      return path.slice(at + marker.length)

    if (path === projectName)
      return ''

    if (path.startsWith(`${projectName}/`))
      return path.slice(projectName.length + 1)
  }

  // 已经是相对路径就原样留着
  if (!path.startsWith('/'))
    return path

  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 2)
    return segments.join('/')

  return `…/${segments.slice(-2).join('/')}`
}

/** 入参是流式拼出来的，中途一定不是合法 JSON，解析失败是常态，不当错误处理 */
function parseToolInput(content?: string): Record<string, unknown> | null {
  if (!content?.trim())
    return null

  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  }
  catch {
    return null
  }
}

function readString(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim())
      return value.trim()
  }
  return ''
}

const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed'])

function readTodos(input: Record<string, unknown>): ToolTodoItem[] {
  const raw = input.todos
  if (!Array.isArray(raw))
    return []

  const todos: ToolTodoItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object')
      continue

    const record = item as Record<string, unknown>
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if (!content)
      continue

    const status = typeof record.status === 'string' && TODO_STATUSES.has(record.status)
      ? (record.status as ToolTodoItem['status'])
      : 'pending'

    todos.push({ content, status })
  }
  return todos
}

/**
 * 认得出来的工具翻成「动作 + 宾语」，认不出来的返回 actionKey 为 null，
 * 由调用方退回原来的「工具名 + 截断的入参」那套展示。
 */
export function describeToolStep(
  toolName: string | undefined,
  content: string | undefined,
  projectName?: string,
): ToolStepDisplay {
  const none: ToolStepDisplay = { actionKey: null, target: '' }
  if (!toolName)
    return none

  const input = parseToolInput(content)
  if (!input)
    return none

  const relative = (raw: string) => toProjectRelativePath(raw, projectName)

  switch (formatToolName(toolName)) {
    case 'Read':
      return { actionKey: 'toolAction.read', target: relative(readString(input, 'file_path', 'path')) }
    case 'Write':
      return { actionKey: 'toolAction.write', target: relative(readString(input, 'file_path', 'path')) }
    case 'Edit':
    case 'MultiEdit':
      return { actionKey: 'toolAction.edit', target: relative(readString(input, 'file_path', 'path')) }
    case 'NotebookEdit':
      return { actionKey: 'toolAction.edit', target: relative(readString(input, 'notebook_path', 'file_path')) }
    case 'Glob':
      return { actionKey: 'toolAction.glob', target: readString(input, 'pattern') }
    case 'Grep':
      return { actionKey: 'toolAction.grep', target: readString(input, 'pattern') }
    case 'Bash':
      return { actionKey: 'toolAction.bash', target: readString(input, 'command', 'description') }
    case 'TodoWrite': {
      const todos = readTodos(input)
      return todos.length > 0
        ? { actionKey: 'toolAction.todo', target: '', todos }
        : none
    }
    default:
      return none
  }
}
