import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SseHandlers {
  onMessage: (message: unknown) => void
  onError: (error: Error) => void
  onDone: () => void
}

/** 最近一次 run 交给 createTaskWithSSE 的三个回调，用例靠它模拟服务端推流 */
let handlers: SseHandlers | null = null
const createTaskWithSSE = vi.fn()
const abortTask = vi.fn()

vi.mock('@/api/ai/ai.api', () => ({
  agentApi: {
    createTaskWithSSE: (...a: unknown[]) => createTaskWithSSE(...a),
    abortTask: (...a: unknown[]) => abortTask(...a),
  },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))

const { ExtractAnglesDialog } = await import('./ExtractAnglesDialog')
const { buildExtractAnglesPrompt } = await import('./angles.utils')

beforeEach(() => {
  vi.clearAllMocks()
  handlers = null
  createTaskWithSSE.mockImplementation(
    (_params: unknown, onMessage: SseHandlers['onMessage'], onError: SseHandlers['onError'], onDone: SseHandlers['onDone']) => {
      handlers = { onMessage, onError, onDone }
      return Promise.resolve(() => {})
    },
  )
})

function renderDialog(overrides: Partial<Parameters<typeof ExtractAnglesDialog>[0]> = {}) {
  const props = {
    open: true,
    projectName: 'forty-weeks',
    existingSlugs: ['pain-first'],
    onOpenChange: vi.fn(),
    onFinished: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<ExtractAnglesDialog {...props} />) }
}

/** 点「开始」，等到状态真的进 running */
async function start() {
  await userEvent.click(screen.getByRole('button', { name: /angles.extract.start/ }))
  await waitFor(() => expect(handlers).not.toBeNull())
}

/** 推一条助手消息进去，走的是服务端真实的两层结构 */
async function pushAssistantText(text: string) {
  await act(async () => {
    handlers?.onMessage({ type: 'assistant', message: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
  })
}

describe('extractAnglesDialog 起任务', () => {
  it('没跑之前不显示过程框，只有开始和关闭', () => {
    renderDialog()

    expect(screen.getByRole('button', { name: /angles.extract.start/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /angles.extract.close/ })).toBeInTheDocument()
    expect(screen.queryByText('angles.extract.waiting')).not.toBeInTheDocument()
  })

  /** Agent 的工作目录靠 projectName 锁定，prompt 里要带上已有 slug 让它别重复提 */
  it('起任务时带上项目英文名和已有方向', async () => {
    renderDialog()
    await start()

    expect(createTaskWithSSE).toHaveBeenCalledTimes(1)
    expect(createTaskWithSSE.mock.calls[0][0]).toEqual({
      prompt: buildExtractAnglesPrompt('forty-weeks', ['pain-first']),
      projectName: 'forty-weeks',
    })
    expect(createTaskWithSSE.mock.calls[0][0].prompt).toContain('pain-first')
  })

  it('关闭按钮把 open 交回给外层', async () => {
    const { props } = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: /angles.extract.close/ }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('extractAnglesDialog 跑的过程', () => {
  it('跑起来之后换成停止 + 运行中，运行中那颗点不动', async () => {
    renderDialog()
    await start()

    expect(await screen.findByRole('button', { name: /angles.extract.stop/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /angles.extract.running/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /angles.extract.start/ })).not.toBeInTheDocument()
  })

  /** 一条日志都还没来时也要有东西显示，否则就是「转着圈、什么都没有」 */
  it('还没有日志时显示等待中', async () => {
    renderDialog()
    await start()

    expect(await screen.findByText('angles.extract.waiting')).toBeInTheDocument()
  })

  it('助手说的话一行行显示出来', async () => {
    renderDialog()
    await start()
    await pushAssistantText('正在读 background/')
    await pushAssistantText('提炼出 4 个方向')

    expect(await screen.findByText('正在读 background/')).toBeInTheDocument()
    expect(screen.getByText('提炼出 4 个方向')).toBeInTheDocument()
    expect(screen.queryByText('angles.extract.waiting')).not.toBeInTheDocument()
  })

  it('点停止走服务端的中断接口，页面立刻回到可操作', async () => {
    renderDialog()
    await start()
    await act(async () => {
      handlers?.onMessage({ taskId: 'task-1', type: 'init' })
    })

    await userEvent.click(screen.getByRole('button', { name: /angles.extract.stop/ }))

    await waitFor(() => expect(abortTask).toHaveBeenCalledWith('task-1'))
    // 停掉之后状态退回 idle，过程框收起来，按钮也回到「开始」
    expect(await screen.findByRole('button', { name: /angles.extract.start/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /angles.extract.stop/ })).not.toBeInTheDocument()
  })

  /** 跑着的时候不让点外面关掉，免得以为已经停了 */
  it('跑着的时候按 Esc 关不掉', async () => {
    const { props } = renderDialog()
    await start()

    await userEvent.keyboard('{Escape}')
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it('没在跑的时候按 Esc 能关掉', async () => {
    const { props } = renderDialog()

    await userEvent.keyboard('{Escape}')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('extractAnglesDialog 收口', () => {
  it('跑完通知外层刷新，并且按钮变成「再来一次」', async () => {
    const { props } = renderDialog()
    await start()
    await pushAssistantText('写好了 angles/pain-second.md')
    await act(async () => {
      handlers?.onDone()
    })

    expect(await screen.findByText('angles.extract.done')).toBeInTheDocument()
    expect(screen.getByText('angles.extract.doneHint')).toBeInTheDocument()
    expect(props.onFinished).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /angles.extract.again/ })).toBeInTheDocument()
  })

  it('连接出错时把错误说出来，不通知刷新', async () => {
    const { props } = renderDialog()
    await start()
    await act(async () => {
      handlers?.onError(new Error('连接断了'))
    })

    expect(await screen.findByText(/angles.extract.failed/)).toBeInTheDocument()
    expect(screen.getByText(/连接断了/)).toBeInTheDocument()
    expect(props.onFinished).not.toHaveBeenCalled()
  })

  /**
   * 失败是当成一条普通分片发过来的，连接随后正常关闭。
   * 只看关闭事件的话页面会显示「跑完了」，还会去刷新一个空列表。
   */
  it('失败分片要落到失败，不能当成跑完了', async () => {
    const { props } = renderDialog()
    await start()
    await act(async () => {
      handlers?.onMessage({ type: 'error', message: '余额不足' })
    })

    expect(await screen.findByText(/angles.extract.failed/)).toBeInTheDocument()
    expect(screen.getByText(/余额不足/)).toBeInTheDocument()

    // 连接随后照样正常关闭，这时候不能再翻回「跑完了」
    await act(async () => {
      handlers?.onDone()
    })
    expect(screen.queryByText('angles.extract.done')).not.toBeInTheDocument()
    expect(props.onFinished).not.toHaveBeenCalled()
  })

  /** 关掉弹窗就把上一次的过程清掉，下次打开是干净的 */
  it('关掉再打开时上一次的过程已经清掉了', async () => {
    const { props, rerender } = renderDialog()
    await start()
    await pushAssistantText('上一次的日志')
    expect(await screen.findByText('上一次的日志')).toBeInTheDocument()

    rerender(<ExtractAnglesDialog {...props} open={false} />)
    rerender(<ExtractAnglesDialog {...props} open={true} />)

    await waitFor(() => expect(screen.queryByText('上一次的日志')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /angles.extract.start/ })).toBeInTheDocument()
  })
})
