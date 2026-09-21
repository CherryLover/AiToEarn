import type { Device } from '@/api/devices/device.types'
import type { ExecutionTaskListItem } from '@/api/devices/execution-task.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ExecutionTaskMode,
  ExecutionTaskStatus,
  ExecutionTaskType,
} from '@/api/devices/execution-task.types'

const revokeDeviceApi = vi.fn()
const updateDeviceApi = vi.fn()
const getExecutionTaskListApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/devices/device.api', () => ({
  revokeDeviceApi: (...a: unknown[]) => revokeDeviceApi(...a),
  updateDeviceApi: (...a: unknown[]) => updateDeviceApi(...a),
}))
vi.mock('@/api/devices/execution-task.api', () => ({
  getExecutionTaskListApi: (...a: unknown[]) => getExecutionTaskListApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象，带参数的把参数值接在后面，好断言到底显示的是哪台设备 */
const translator = {
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { DeviceCard } = await import('./index')

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: '家里的 Mac',
    online: true,
    capabilities: ['xhs', 'douyin'],
    accounts: [{ platform: 'xhs', accountName: '四十周', accountId: 'u1' }],
    lastSeenAt: '2026-09-21T03:00:00.000Z',
    version: '0.1.0',
    platform: 'macOS 15',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

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
  return { code: 0, data: { page: 1, pageSize: 5, totalPages: 1, total: list.length, list } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getExecutionTaskListApi.mockResolvedValue(taskList([task()]))
})

function renderCard(item = device()) {
  const onChanged = vi.fn()
  const view = render(<DeviceCard device={item} onChanged={onChanged} />)
  return { onChanged, ...view }
}

describe('deviceCard 基本信息', () => {
  it('在线的设备把名字、状态、版本、能力和账号都摆出来', () => {
    renderCard()

    expect(screen.getByText('家里的 Mac')).toBeInTheDocument()
    expect(screen.getByText('device.status.online')).toBeInTheDocument()
    expect(screen.getByText(/device.version 0.1.0/)).toBeInTheDocument()
    expect(screen.getByText('capability.xhs')).toBeInTheDocument()
    expect(screen.getByText('capability.douyin')).toBeInTheDocument()
    expect(screen.getByText('capability.xhs · 四十周')).toBeInTheDocument()
  })

  it('离线且从没上线过的设备说清楚', () => {
    renderCard(device({ online: false, lastSeenAt: null }))

    expect(screen.getByText('device.status.offline')).toBeInTheDocument()
    expect(screen.getByText('device.neverSeen')).toBeInTheDocument()
  })

  /** 版本和机器是插件上报的，刚配对完可能还没报上来 */
  it('版本和机器缺失时显示未知', () => {
    renderCard(device({ version: null, platform: null }))

    expect(screen.getByText(/device.version device.unknown/)).toBeInTheDocument()
    expect(screen.getByText(/device.platform device.unknown/)).toBeInTheDocument()
  })

  it('还没上报能力和账号时分别给出说明', () => {
    renderCard(device({ capabilities: [], accounts: [] }))

    expect(screen.getByText('device.noCapabilities')).toBeInTheDocument()
    expect(screen.getByText('device.noAccounts')).toBeInTheDocument()
  })

  /** 服务端不限定能力取值，没收录的直接把原始值显示出来，总比显示不出来强 */
  it('没收录的能力原样显示', () => {
    renderCard(device({ capabilities: ['zhihu'], accounts: [{ platform: 'zhihu' }] }))

    // 能力一处、账号一处
    expect(screen.getAllByText('zhihu')).toHaveLength(2)
  })
})

describe('deviceCard 最近工单', () => {
  it('展开之后才去拉最近工单', async () => {
    renderCard()
    expect(getExecutionTaskListApi).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /action.viewTasks/ }))

    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenCalledWith({
      deviceId: 'd1',
      page: 1,
      pageSize: 5,
    }))
    expect(await screen.findByText('taskType.echo')).toBeInTheDocument()
    expect(screen.getByText('taskStatus.succeeded')).toBeInTheDocument()
    expect(screen.getByText(/tasks.durationSeconds 12/)).toBeInTheDocument()
  })

  it('还没跑完的工单不显示耗时', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([
      task({ status: ExecutionTaskStatus.Running, startedAt: '2026-09-21T03:00:00.000Z', finishedAt: null }),
    ]))
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.viewTasks/ }))

    expect(await screen.findByText('tasks.durationPending')).toBeInTheDocument()
  })

  it('失败的工单把原因带出来', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([
      task({ status: ExecutionTaskStatus.Failed, error: '小红书没登录' }),
    ]))
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.viewTasks/ }))

    expect(await screen.findByText('小红书没登录')).toBeInTheDocument()
  })

  it('一条工单都没有时给出说明', async () => {
    getExecutionTaskListApi.mockResolvedValue(taskList([]))
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.viewTasks/ }))

    expect(await screen.findByText('device.recentTasks.empty')).toBeInTheDocument()
  })

  it('拉不到最近工单时说一声', async () => {
    getExecutionTaskListApi.mockRejectedValue(new Error('offline'))
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.viewTasks/ }))

    expect(await screen.findByText('device.recentTasks.loadFailed')).toBeInTheDocument()
  })

  it('再点一下收起来', async () => {
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.viewTasks/ }))
    await screen.findByText('taskType.echo')

    await userEvent.click(screen.getByRole('button', { name: /action.hideTasks/ }))

    expect(screen.queryByText('taskType.echo')).not.toBeInTheDocument()
  })
})

describe('deviceCard 吊销', () => {
  it('先二次确认，确认之后才真的吊销', async () => {
    revokeDeviceApi.mockResolvedValue({ code: 0, data: null })
    const { onChanged } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.revoke/ }))
    expect(await screen.findByText('revoke.title')).toBeInTheDocument()
    expect(revokeDeviceApi).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /revoke.confirm/ }))

    await waitFor(() => expect(revokeDeviceApi).toHaveBeenCalledWith('d1'))
    expect(toastSuccess).toHaveBeenCalledWith('revoke.success')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('吊销失败时把业务码翻成具体说法', async () => {
    revokeDeviceApi.mockResolvedValue({ code: 20303 })
    const { onChanged } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.revoke/ }))
    await userEvent.click(await screen.findByRole('button', { name: /revoke.confirm/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.deviceNotFound'))
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('请求本身没通时说不出所以然', async () => {
    revokeDeviceApi.mockRejectedValue(new Error('offline'))
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.revoke/ }))
    await userEvent.click(await screen.findByRole('button', { name: /revoke.confirm/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.unknown'))
  })

  it('改名走的是改名弹窗，改完让父级刷新', async () => {
    updateDeviceApi.mockResolvedValue({ code: 0, data: null })
    const { onChanged } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: /action.rename/ }))
    const input = await screen.findByLabelText(/rename.label/)
    await userEvent.clear(input)
    await userEvent.type(input, '书房的 Mac')
    await userEvent.click(screen.getByRole('button', { name: /action.save/ }))

    await waitFor(() => expect(updateDeviceApi).toHaveBeenCalledWith('d1', { name: '书房的 Mac' }))
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
