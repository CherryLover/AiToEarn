import type { Device } from '@/api/devices/device.types'
import type { ExecutionTaskDetail } from '@/api/devices/execution-task.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ExecutionTaskMode,
  ExecutionTaskStatus,
  ExecutionTaskType,
} from '@/api/devices/execution-task.types'

const getExecutionTaskDetailApi = vi.fn()

vi.mock('@/api/devices/execution-task.api', () => ({
  getExecutionTaskDetailApi: (...a: unknown[]) => getExecutionTaskDetailApi(...a),
}))
/** 文案键就是断言对象，带参数的把参数值接在后面 */
const translator = {
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { TaskDetailDialog } = await import('./index')

function device(id: string, name: string): Device {
  return {
    id,
    name,
    online: true,
    capabilities: [],
    accounts: [],
    lastSeenAt: null,
    version: null,
    platform: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  }
}

const DEVICES = [device('d1', '家里的 Mac')]

function detail(overrides: Partial<ExecutionTaskDetail> = {}): ExecutionTaskDetail {
  return {
    id: 'task-1',
    projectId: 'p1',
    angleId: null,
    type: ExecutionTaskType.Echo,
    mode: ExecutionTaskMode.Auto,
    status: ExecutionTaskStatus.Succeeded,
    targetDeviceId: null,
    deviceId: 'd1',
    requiredCapability: null,
    error: null,
    errorCode: null,
    attempts: 1,
    maxAttempts: 3,
    availableAt: '2026-09-21T03:00:00.000Z',
    leaseExpiresAt: null,
    priority: 0,
    startedAt: '2026-09-21T03:00:00.000Z',
    finishedAt: '2026-09-21T03:00:12.000Z',
    createdAt: '2026-09-21T03:00:00.000Z',
    updatedAt: '2026-09-21T03:00:12.000Z',
    payload: { message: 'hello from web' },
    result: { echo: 'hello from web' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getExecutionTaskDetailApi.mockResolvedValue({ code: 0, data: detail() })
})

function renderDialog(taskId: string | null = 'task-1', devices = DEVICES) {
  const onOpenChange = vi.fn()
  const view = render(
    <TaskDetailDialog taskId={taskId} devices={devices} open={Boolean(taskId)} onOpenChange={onOpenChange} />,
  )
  return { onOpenChange, ...view }
}

describe('taskDetailDialog', () => {
  it('打开时拉详情，概况、载荷和结果都摆出来', async () => {
    renderDialog()

    await waitFor(() => expect(getExecutionTaskDetailApi).toHaveBeenCalledWith('task-1'))
    expect(await screen.findByText('taskType.echo')).toBeInTheDocument()
    expect(screen.getByText('taskStatus.succeeded')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByText(/detail.durationValue 12/)).toBeInTheDocument()
    // 载荷里一处、结果里一处
    expect(screen.getAllByText(/hello from web/)).toHaveLength(2)
  })

  /** 载荷结构按工单类型各不相同，详情只原样转成可读 JSON，不做二次解析 */
  it('载荷原样转成可读 JSON', async () => {
    renderDialog()

    const payload = await screen.findByText(/"message": "hello from web"/)
    expect(payload.tagName).toBe('PRE')
  })

  it('还没跑完时耗时给占位，没有结果时说明一声', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({
      code: 0,
      data: detail({ status: ExecutionTaskStatus.Running, finishedAt: null, result: null }),
    })
    renderDialog()

    expect(await screen.findByText('detail.durationPending')).toBeInTheDocument()
    expect(screen.getByText('detail.noResult')).toBeInTheDocument()
  })

  it('失败的工单把原因单独列出来', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({
      code: 0,
      data: detail({ status: ExecutionTaskStatus.Failed, error: '小红书没登录' }),
    })
    renderDialog()

    expect(await screen.findByText('detail.error')).toBeInTheDocument()
    expect(screen.getByText('小红书没登录')).toBeInTheDocument()
  })

  it('领走的设备显示成设备名', async () => {
    renderDialog()

    expect(await screen.findByText('家里的 Mac')).toBeInTheDocument()
  })

  /** 设备被吊销之后列表里就没它了，但工单上的 deviceId 还留着 */
  it('设备已经不在列表里时显示未知设备', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({ code: 0, data: detail({ deviceId: 'gone' }) })
    renderDialog()

    expect(await screen.findByText('tasks.unknownDevice')).toBeInTheDocument()
  })

  it('没指定也没被领走时显示任意合格设备', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({
      code: 0,
      data: detail({ deviceId: null, targetDeviceId: null, requiredCapability: null }),
    })
    renderDialog()

    expect(await screen.findByText('tasks.anyDevice')).toBeInTheDocument()
    expect(screen.getByText('detail.noCapability')).toBeInTheDocument()
  })

  it('指定了设备但还没人领时显示指定的那台', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({
      code: 0,
      data: detail({ deviceId: null, targetDeviceId: 'd1', status: ExecutionTaskStatus.Pending }),
    })
    renderDialog()

    expect(await screen.findByText('家里的 Mac')).toBeInTheDocument()
  })

  it('拉不到详情时说一声', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({ code: 20400, data: null })
    renderDialog()

    expect(await screen.findByText('detail.loadFailed')).toBeInTheDocument()
  })

  it('请求本身没通时也说一声', async () => {
    getExecutionTaskDetailApi.mockRejectedValue(new Error('offline'))
    renderDialog()

    expect(await screen.findByText('detail.loadFailed')).toBeInTheDocument()
  })

  it('没选中工单时不去拉详情', () => {
    renderDialog(null)

    expect(getExecutionTaskDetailApi).not.toHaveBeenCalled()
  })

  it('点关闭交给父级收起来', async () => {
    const { onOpenChange } = renderDialog()
    await screen.findByText('taskType.echo')

    await userEvent.click(screen.getByRole('button', { name: /action.close/ }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
