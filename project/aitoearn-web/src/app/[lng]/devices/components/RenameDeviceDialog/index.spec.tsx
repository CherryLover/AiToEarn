import type { Device } from '@/api/devices/device.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateDeviceApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/devices/device.api', () => ({
  updateDeviceApi: (...a: unknown[]) => updateDeviceApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/**
 * 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到。
 * 带参数的键把参数值接在后面，好断言「显示出来的是哪台设备」这类事。
 * 每次返回同一个对象：`t` 是好几处 useCallback 的依赖，换一个新的就会让 effect 一直重跑。
 */
const translator = {
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { RenameDeviceDialog } = await import('./index')

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
})

function renderDialog(item = device()) {
  const onOpenChange = vi.fn()
  const onRenamed = vi.fn()
  const view = render(
    <RenameDeviceDialog device={item} open onOpenChange={onOpenChange} onRenamed={onRenamed} />,
  )
  return { onOpenChange, onRenamed, ...view }
}

describe('renameDeviceDialog', () => {
  it('打开时把当前名字填好', () => {
    renderDialog()

    expect(screen.getByLabelText(/rename.label/)).toHaveValue('家里的 Mac')
  })

  it('名字清空时提示并禁用保存', async () => {
    renderDialog()

    await userEvent.clear(screen.getByLabelText(/rename.label/))

    expect(screen.getByText('rename.emptyError')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /action.save/ })).toBeDisabled()
  })

  /** 前后空格是手滑打出来的，存之前去掉 */
  it('改完保存，名字两头的空格不带进去', async () => {
    updateDeviceApi.mockResolvedValue({ code: 0, data: null })
    const { onRenamed, onOpenChange } = renderDialog()

    const input = screen.getByLabelText(/rename.label/)
    await userEvent.clear(input)
    await userEvent.type(input, '  书房的 Mac  ')
    await userEvent.click(screen.getByRole('button', { name: /action.save/ }))

    await waitFor(() => expect(updateDeviceApi).toHaveBeenCalledWith('d1', { name: '书房的 Mac' }))
    expect(toastSuccess).toHaveBeenCalledWith('rename.success')
    expect(onRenamed).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('名字不合规时把业务码翻成具体说法', async () => {
    updateDeviceApi.mockResolvedValue({ code: 20308 })
    const { onRenamed } = renderDialog()

    await userEvent.type(screen.getByLabelText(/rename.label/), '!')
    await userEvent.click(screen.getByRole('button', { name: /action.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.deviceNameInvalid'))
    expect(onRenamed).not.toHaveBeenCalled()
  })

  it('请求本身没通时说不出所以然', async () => {
    updateDeviceApi.mockRejectedValue(new Error('offline'))
    renderDialog()

    await userEvent.type(screen.getByLabelText(/rename.label/), '!')
    await userEvent.click(screen.getByRole('button', { name: /action.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.unknown'))
  })

  it('取消直接关掉，不发请求', async () => {
    const { onOpenChange } = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: /action.cancel/ }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(updateDeviceApi).not.toHaveBeenCalled()
  })
})
