import type { Device } from '@/api/devices/device.types'
import type { ExecutionTaskListItem } from '@/api/devices/execution-task.types'
import { chooseOption } from '@test/radix'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ExecutionTaskMode,
  ExecutionTaskStatus,
  ExecutionTaskType,
} from '@/api/devices/execution-task.types'

const cancelExecutionTaskApi = vi.fn()
const getExecutionTaskListApi = vi.fn()
const getExecutionTaskDetailApi = vi.fn()
const retryExecutionTaskApi = vi.fn()
const createEchoTaskApi = vi.fn()
const getProjectListApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/devices/execution-task.api', () => ({
  cancelExecutionTaskApi: (...a: unknown[]) => cancelExecutionTaskApi(...a),
  createEchoTaskApi: (...a: unknown[]) => createEchoTaskApi(...a),
  getExecutionTaskDetailApi: (...a: unknown[]) => getExecutionTaskDetailApi(...a),
  getExecutionTaskListApi: (...a: unknown[]) => getExecutionTaskListApi(...a),
  retryExecutionTaskApi: (...a: unknown[]) => retryExecutionTaskApi(...a),
}))
vi.mock('@/api/projects/project.api', () => ({
  getProjectListApi: (...a: unknown[]) => getProjectListApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/**
 * 文案键就是断言对象，带参数的把参数值接在后面，好断言「这活归哪台设备」这类事。
 * 每次返回同一个对象：`t` 在拉列表的 useCallback 依赖里，换一个新的就会一直重拉。
 */
const translator = {
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { TasksTab } = await import('./index')

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

const DEVICES = [device('d1', '家里的 Mac'), device('d2', '公司的 Win')]

function task(overrides: Partial<ExecutionTaskListItem> = {}): ExecutionTaskListItem {
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
    ...overrides,
  }
}

function taskList(list: ExecutionTaskListItem[]) {
  return { code: 0, data: { page: 1, pageSize: 20, totalPages: 1, total: list.length, list } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getExecutionTaskListApi.mockResolvedValue(taskList([task()]))
  getProjectListApi.mockResolvedValue({ code: 0, data: [] })
})

async function renderTab(devices = DEVICES) {
  const view = render(<TasksTab devices={devices} />)
  await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenCalled())
  return view
}

describe('tasksTab 列表', () => {
  it('把工单的类型、状态、设备、尝试次数和耗时都摆出来', async () => {
    await renderTab()

    expect(await screen.findByText('taskType.echo')).toBeInTheDocument()
    expect(screen.getByText('taskStatus.succeeded')).toBeInTheDocument()
    expect(screen.getByText(/tasks.column.device 家里的 Mac/)).toBeInTheDocument()
    expect(screen.getByText(/tasks.column.attempts 1 3/)).toBeInTheDocument()
    expect(screen.getByText(/tasks.durationSeconds 12/)).toBeInTheDocument()
  })

  /** 手动工单是给人发的，插件不领，列表上得一眼看出来 */
  it('手动工单单独标一下', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ mode: ExecutionTaskMode.Manual })]))
    await renderTab()

    expect(await screen.findByText('taskMode.manual')).toBeInTheDocument()
  })

  it('没被领走也没指定设备时显示任意合格设备', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ deviceId: null, targetDeviceId: null })]))
    await renderTab()

    expect(await screen.findByText(/tasks.column.device tasks.anyDevice/)).toBeInTheDocument()
  })

  /** 设备被吊销之后列表里就没它了，工单上的 deviceId 还留着 */
  it('设备已经不在列表里时显示未知设备', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ deviceId: 'gone' })]))
    await renderTab()

    expect(await screen.findByText(/tasks.column.device tasks.unknownDevice/)).toBeInTheDocument()
  })

  it('一条工单都没有时给建单入口', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([]))
    await renderTab()

    expect(await screen.findByText('tasks.empty.title')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /action.createEcho/ }).length).toBeGreaterThan(0)
  })

  it('拉列表失败时说一声', async () => {
    getExecutionTaskListApi.mockResolvedValue({ code: 20400, data: null })
    await renderTab()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('tasks.loadFailed'))
  })

  it('请求本身没通时也说一声', async () => {
    getExecutionTaskListApi.mockRejectedValue(new Error('offline'))
    await renderTab()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('tasks.loadFailed'))
  })

  it('刷新会重新拉一次', async () => {
    await renderTab()
    await screen.findByText('taskType.echo')

    await userEvent.click(screen.getByRole('button', { name: /action.refresh/ }))

    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenCalledTimes(2))
  })
})

describe('tasksTab 筛选', () => {
  it('按状态筛会把状态带进请求', async () => {
    await renderTab()
    await screen.findByText('taskType.echo')

    await chooseOption(screen.getAllByRole('combobox')[0], /taskStatus.failed/)

    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: ExecutionTaskStatus.Failed }),
    ))
  })

  it('按类型筛会把类型带进请求', async () => {
    await renderTab()
    await screen.findByText('taskType.echo')

    await chooseOption(screen.getAllByRole('combobox')[1], /taskType.publish/)

    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: ExecutionTaskType.Publish }),
    ))
  })

  it('按设备筛会把设备带进请求', async () => {
    await renderTab()
    await screen.findByText('taskType.echo')

    await chooseOption(screen.getAllByRole('combobox')[2], /公司的 Win/)

    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId: 'd2' }),
    ))
  })

  /** 「全部」是页面自己造的取值，不能原样发给服务端 */
  it('默认的「全部」不往请求里塞筛选字段', async () => {
    await renderTab()

    expect(getExecutionTaskListApi).toHaveBeenCalledWith({
      status: undefined,
      type: undefined,
      deviceId: undefined,
      page: 1,
      pageSize: 20,
    })
  })
})

describe('tasksTab 重试和取消', () => {
  it('只有失败的工单给重试，点了就重试并刷新', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ status: ExecutionTaskStatus.Failed, error: '没登录' })]))
    retryExecutionTaskApi.mockResolvedValue({ code: 0, data: null })
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /action.retry/ }))

    await waitFor(() => expect(retryExecutionTaskApi).toHaveBeenCalledWith('task-1'))
    expect(toastSuccess).toHaveBeenCalledWith('tasks.retrySuccess')
    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenCalledTimes(2))
  })

  it('已经跑完的工单不给重试也不给取消', async () => {
    await renderTab()
    await screen.findByText('taskType.echo')

    expect(screen.queryByRole('button', { name: /action.retry/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /action.cancelTask/ })).not.toBeInTheDocument()
  })

  it('重试失败时把业务码翻成具体说法', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ status: ExecutionTaskStatus.Failed })]))
    retryExecutionTaskApi.mockResolvedValue({ code: 20415 })
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /action.retry/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.taskRetryNotAllowed'))
  })

  it('重试请求没通时说不出所以然', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ status: ExecutionTaskStatus.Failed })]))
    retryExecutionTaskApi.mockRejectedValue(new Error('offline'))
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /action.retry/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.unknown'))
  })

  it('还在跑的工单给取消，确认之后才真的取消', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ status: ExecutionTaskStatus.Pending, startedAt: null, finishedAt: null })]))
    cancelExecutionTaskApi.mockResolvedValue({ code: 0, data: null })
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /action.cancelTask/ }))
    expect(await screen.findByText('tasks.cancelConfirmTitle')).toBeInTheDocument()
    expect(cancelExecutionTaskApi).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /action.cancelTask/ }))

    await waitFor(() => expect(cancelExecutionTaskApi).toHaveBeenCalledWith('task-1'))
    expect(toastSuccess).toHaveBeenCalledWith('tasks.cancelSuccess')
  })

  it('取消失败时把业务码翻成具体说法', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([task({ status: ExecutionTaskStatus.Running, finishedAt: null })]))
    cancelExecutionTaskApi.mockResolvedValue({ code: 20414 })
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /action.cancelTask/ }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /action.cancelTask/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.taskCancelNotAllowed'))
  })
})

describe('tasksTab 详情和建单', () => {
  it('点详情就去拉这条工单的详情', async () => {
    getExecutionTaskDetailApi.mockResolvedValue({ code: 0, data: null })
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /action.detail/ }))

    await waitFor(() => expect(getExecutionTaskDetailApi).toHaveBeenCalledWith('task-1'))
  })

  it('点建 echo 工单打开建单弹窗', async () => {
    await renderTab()
    await screen.findByText('taskType.echo')

    await userEvent.click(screen.getByRole('button', { name: /action.createEcho/ }))

    expect(await screen.findByText('echo.title')).toBeInTheDocument()
    await waitFor(() => expect(getProjectListApi).toHaveBeenCalled())
  })
})
