import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createDevicePairingCodeApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()
const writeText = vi.fn(async () => {})

vi.mock('@/api/devices/device.api', () => ({
  createDevicePairingCodeApi: (...a: unknown[]) => createDevicePairingCodeApi(...a),
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

const { AddDeviceDialog } = await import('./index')

/** 还有 10 分钟过期的配对码，跟服务端默认 TTL 一致 */
function pairingCode(ttlSeconds = 600) {
  return {
    code: 'ABCD1234',
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('navigator', Object.assign(globalThis.navigator, { clipboard: { writeText } }))
  createDevicePairingCodeApi.mockResolvedValue({ code: 0, data: pairingCode() })
})

function renderDialog(open = true) {
  const onOpenChange = vi.fn()
  const onDone = vi.fn()
  const view = render(<AddDeviceDialog open={open} onOpenChange={onOpenChange} onDone={onDone} />)
  return { onOpenChange, onDone, ...view }
}

describe('addDeviceDialog 出码', () => {
  it('一打开就要一个码，连着倒计时和步骤一起给出来', async () => {
    renderDialog()

    expect(await screen.findByTestId('device-pairing-code')).toHaveTextContent('ABCD1234')
    expect(screen.getByText(/pair.expiresIn/)).toBeInTheDocument()
    expect(screen.getByText('pair.step1')).toBeInTheDocument()
  })

  /** 上一次的码可能已经被人用掉了，关了再开必须换一个 */
  it('关掉再打开会重新要一个码', async () => {
    const { rerender, onOpenChange, onDone } = renderDialog(false)
    expect(createDevicePairingCodeApi).not.toHaveBeenCalled()

    rerender(<AddDeviceDialog open onOpenChange={onOpenChange} onDone={onDone} />)
    await screen.findByTestId('device-pairing-code')

    rerender(<AddDeviceDialog open={false} onOpenChange={onOpenChange} onDone={onDone} />)
    rerender(<AddDeviceDialog open onOpenChange={onOpenChange} onDone={onDone} />)

    await waitFor(() => expect(createDevicePairingCodeApi).toHaveBeenCalledTimes(2))
  })

  it('出码失败时把业务码翻成具体说法，并留一个重来的入口', async () => {
    createDevicePairingCodeApi.mockResolvedValue({ code: 20302, data: null })
    renderDialog()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.pairingCodeGenerateFailed'))
    expect(screen.getByText('pair.generateFailed')).toBeInTheDocument()

    createDevicePairingCodeApi.mockResolvedValue({ code: 0, data: pairingCode() })
    await userEvent.click(screen.getByRole('button', { name: /action.regenerate/ }))

    expect(await screen.findByTestId('device-pairing-code')).toHaveTextContent('ABCD1234')
  })

  it('请求本身没通时说不出所以然', async () => {
    createDevicePairingCodeApi.mockRejectedValue(new Error('offline'))
    renderDialog()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.unknown'))
  })

  /** 码已经过期了还让人复制，只会在插件那边白填一次 */
  it('码过期之后不给复制', async () => {
    createDevicePairingCodeApi.mockResolvedValue({ code: 0, data: pairingCode(-10) })
    renderDialog()

    expect(await screen.findByText('pair.expired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /action.copy/ })).toBeDisabled()
  })
})

describe('addDeviceDialog 复制和关闭', () => {
  it('点复制把码写进剪贴板', async () => {
    renderDialog()
    await screen.findByTestId('device-pairing-code')

    await userEvent.click(screen.getByRole('button', { name: /action.copy/ }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD1234'))
    expect(toastSuccess).toHaveBeenCalledWith('pair.copySuccess')
  })

  it('剪贴板写不进去时说一声', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    renderDialog()
    await screen.findByTestId('device-pairing-code')

    await userEvent.click(screen.getByRole('button', { name: /action.copy/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('pair.copyFailed'))
  })

  /** 关的时候插件那边可能已经配好了，让父级顺手刷一遍设备列表 */
  it('点完成关掉并让父级刷新', async () => {
    const { onOpenChange, onDone } = renderDialog()
    await screen.findByTestId('device-pairing-code')

    await userEvent.click(screen.getByRole('button', { name: /pair.done/ }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
