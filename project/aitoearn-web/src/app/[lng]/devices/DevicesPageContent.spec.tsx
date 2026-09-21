import type { Device } from '@/api/devices/device.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createDevicePairingCodeApi = vi.fn()
const getDeviceListApi = vi.fn()
const getExecutionTaskListApi = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/devices/device.api', () => ({
  createDevicePairingCodeApi: (...a: unknown[]) => createDevicePairingCodeApi(...a),
  getDeviceListApi: (...a: unknown[]) => getDeviceListApi(...a),
  revokeDeviceApi: vi.fn(),
  updateDeviceApi: vi.fn(),
}))
vi.mock('@/api/devices/execution-task.api', () => ({
  cancelExecutionTaskApi: vi.fn(),
  createEchoTaskApi: vi.fn(),
  getExecutionTaskDetailApi: vi.fn(),
  getExecutionTaskListApi: (...a: unknown[]) => getExecutionTaskListApi(...a),
  retryExecutionTaskApi: vi.fn(),
}))
vi.mock('@/api/projects/project.api', () => ({
  getProjectListApi: vi.fn().mockResolvedValue({ code: 0, data: [] }),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}))
/**
 * 文案键就是断言对象，带参数的把参数值接在后面。
 * 每次返回同一个对象：`t` 在拉设备列表的 useCallback 依赖里，换一个新的就会一直重拉。
 */
const translator = {
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))
vi.mock('@/hooks', () => ({ useDocumentTitle: () => {} }))

const { DevicesPageContent } = await import('./DevicesPageContent')

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: '家里的 Mac',
    online: true,
    capabilities: ['xhs'],
    accounts: [],
    lastSeenAt: '2026-09-21T03:00:00.000Z',
    version: '0.1.0',
    platform: 'macOS 15',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getDeviceListApi.mockResolvedValue({ code: 0, data: [device()] })
  getExecutionTaskListApi.mockResolvedValue({
    code: 0,
    data: { page: 1, pageSize: 20, totalPages: 0, total: 0, list: [] },
  })
})

async function renderPage() {
  const view = render(<DevicesPageContent />)
  await waitFor(() => expect(getDeviceListApi).toHaveBeenCalled())
  return view
}

describe('devicesPageContent 设备列表', () => {
  it('把配对过的设备列出来', async () => {
    await renderPage()

    expect(await screen.findByTestId('device-card-d1')).toBeInTheDocument()
    expect(screen.getByText('家里的 Mac')).toBeInTheDocument()
  })

  it('一台设备都没有时给添加入口', async () => {
    getDeviceListApi.mockResolvedValue({ code: 0, data: [] })
    await renderPage()

    expect(await screen.findByText('empty.title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /empty.action/ })).toBeInTheDocument()
  })

  /** 返回不是数组时当成空列表，不能让页面崩在 devices.map 上 */
  it('返回不是数组时当成空列表', async () => {
    getDeviceListApi.mockResolvedValue({ code: 0, data: null })
    await renderPage()

    expect(await screen.findByText('empty.title')).toBeInTheDocument()
  })

  it('拉列表失败时说一声', async () => {
    getDeviceListApi.mockResolvedValue({ code: 20303, data: null })
    await renderPage()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('device.loadFailed'))
  })

  it('请求本身没通时也说一声', async () => {
    getDeviceListApi.mockRejectedValue(new Error('offline'))
    await renderPage()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('device.loadFailed'))
  })

  it('刷新会重新拉一次', async () => {
    await renderPage()
    await screen.findByText('家里的 Mac')

    await userEvent.click(screen.getByRole('button', { name: /action.refresh/ }))

    await waitFor(() => expect(getDeviceListApi).toHaveBeenCalledTimes(2))
  })
})

describe('devicesPageContent 添加设备与工单', () => {
  it('点添加设备就出一个配对码', async () => {
    createDevicePairingCodeApi.mockResolvedValue({
      code: 0,
      data: { code: 'ABCD1234', expiresAt: new Date(Date.now() + 600000).toISOString(), ttlSeconds: 600 },
    })
    await renderPage()

    await userEvent.click(screen.getByRole('button', { name: /action.addDevice/ }))

    expect(await screen.findByTestId('device-pairing-code')).toHaveTextContent('ABCD1234')
  })

  /** 配对可能已经在插件那边完成了，关弹窗时顺手刷一遍设备列表 */
  it('关掉配对弹窗会重新拉一遍设备列表', async () => {
    createDevicePairingCodeApi.mockResolvedValue({
      code: 0,
      data: { code: 'ABCD1234', expiresAt: new Date(Date.now() + 600000).toISOString(), ttlSeconds: 600 },
    })
    await renderPage()

    await userEvent.click(screen.getByRole('button', { name: /action.addDevice/ }))
    await screen.findByTestId('device-pairing-code')
    await userEvent.click(screen.getByRole('button', { name: /pair.done/ }))

    await waitFor(() => expect(getDeviceListApi).toHaveBeenCalledTimes(2))
  })

  /** 工单列表挂在第二个标签页下，切过去才去拉 */
  it('切到工单标签页才去拉工单', async () => {
    await renderPage()
    await screen.findByText('家里的 Mac')
    expect(getExecutionTaskListApi).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('tab', { name: /tabs.tasks/ }))

    await waitFor(() => expect(getExecutionTaskListApi).toHaveBeenCalled())
    expect(await screen.findByText('tasks.empty.title')).toBeInTheDocument()
  })
})
