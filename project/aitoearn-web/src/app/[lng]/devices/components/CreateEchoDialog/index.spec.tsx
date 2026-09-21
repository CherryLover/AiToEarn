import type { Device } from '@/api/devices/device.types'
import type { ProjectListItem } from '@/api/projects/project.types'
import { chooseOption } from '@test/radix'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStatus } from '@/api/projects/project.types'

const createEchoTaskApi = vi.fn()
const getProjectListApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/devices/execution-task.api', () => ({
  createEchoTaskApi: (...a: unknown[]) => createEchoTaskApi(...a),
}))
vi.mock('@/api/projects/project.api', () => ({
  getProjectListApi: (...a: unknown[]) => getProjectListApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象，带参数的把参数值接在后面 */
const translator = {
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { CreateEchoDialog } = await import('./index')

function project(id: string, displayName: string): ProjectListItem {
  return {
    id,
    name: id,
    displayName,
    desc: null,
    status: ProjectStatus.Active,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as ProjectListItem
}

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectListApi.mockResolvedValue({ code: 0, data: [project('p1', '四十周'), project('p2', '别的项目')] })
})

async function renderDialog(devices = DEVICES) {
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  const view = render(
    <CreateEchoDialog open devices={devices} onOpenChange={onOpenChange} onCreated={onCreated} />,
  )
  await waitFor(() => expect(getProjectListApi).toHaveBeenCalled())
  return { onOpenChange, onCreated, ...view }
}

describe('createEchoDialog 选项目', () => {
  /** 归档项目不能派活，所以只列进行中的 */
  it('只列进行中的项目，并默认选中第一个', async () => {
    await renderDialog()

    expect(getProjectListApi).toHaveBeenCalledWith(ProjectStatus.Active)
    expect(await screen.findByText('四十周')).toBeInTheDocument()
  })

  it('一个项目都没有时禁用下拉并说明', async () => {
    getProjectListApi.mockResolvedValue({ code: 0, data: [] })
    await renderDialog()

    expect(await screen.findByText('echo.noProject')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /echo.submit/ })).toBeDisabled()
  })

  it('拉项目失败时说一声', async () => {
    getProjectListApi.mockResolvedValue({ code: 20000, data: null })
    await renderDialog()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('echo.loadProjectFailed'))
  })

  it('请求本身没通时也说一声', async () => {
    getProjectListApi.mockRejectedValue(new Error('offline'))
    await renderDialog()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('echo.loadProjectFailed'))
  })
})

describe('createEchoDialog 建单', () => {
  /** 不指定设备就是任意合格设备都能领，这时候不该往请求里塞一个空 deviceId */
  it('默认发给任意合格设备，不带 targetDeviceId', async () => {
    createEchoTaskApi.mockResolvedValue({ code: 0, data: { id: 'task-1' } })
    const { onCreated, onOpenChange } = await renderDialog()

    await screen.findByText('四十周')
    await userEvent.click(screen.getByRole('button', { name: /echo.submit/ }))

    await waitFor(() => expect(createEchoTaskApi).toHaveBeenCalledWith({
      projectId: 'p1',
      message: 'hello from web',
      targetDeviceId: undefined,
    }))
    expect(toastSuccess).toHaveBeenCalledWith('echo.success')
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('指定设备之后把设备带上', async () => {
    createEchoTaskApi.mockResolvedValue({ code: 0, data: { id: 'task-1' } })
    await renderDialog()
    await screen.findByText('四十周')

    const deviceSelect = screen.getAllByRole('combobox')[1]
    await chooseOption(deviceSelect, /家里的 Mac/)
    await userEvent.click(screen.getByRole('button', { name: /echo.submit/ }))

    await waitFor(() => expect(createEchoTaskApi).toHaveBeenCalledWith({
      projectId: 'p1',
      message: 'hello from web',
      targetDeviceId: 'd1',
    }))
  })

  it('换一个项目就发到那个项目名下', async () => {
    createEchoTaskApi.mockResolvedValue({ code: 0, data: { id: 'task-1' } })
    await renderDialog()
    await screen.findByText('四十周')

    await chooseOption(screen.getAllByRole('combobox')[0], /别的项目/)
    await userEvent.click(screen.getByRole('button', { name: /echo.submit/ }))

    await waitFor(() => expect(createEchoTaskApi).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p2' }),
    ))
  })

  it('内容清空之后不让提交', async () => {
    await renderDialog()
    await screen.findByText('四十周')

    await userEvent.clear(screen.getByLabelText(/echo.message/))

    expect(screen.getByRole('button', { name: /echo.submit/ })).toBeDisabled()
  })

  it('建单失败时把业务码翻成具体说法', async () => {
    createEchoTaskApi.mockResolvedValue({ code: 20413 })
    const { onCreated } = await renderDialog()

    await screen.findByText('四十周')
    await userEvent.click(screen.getByRole('button', { name: /echo.submit/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.taskCreateFailed'))
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('请求本身没通时说不出所以然', async () => {
    createEchoTaskApi.mockRejectedValue(new Error('offline'))
    await renderDialog()

    await screen.findByText('四十周')
    await userEvent.click(screen.getByRole('button', { name: /echo.submit/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.unknown'))
  })

  it('取消直接关掉，不建单', async () => {
    const { onOpenChange } = await renderDialog()

    await userEvent.click(screen.getByRole('button', { name: /action.cancel/ }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createEchoTaskApi).not.toHaveBeenCalled()
  })
})
