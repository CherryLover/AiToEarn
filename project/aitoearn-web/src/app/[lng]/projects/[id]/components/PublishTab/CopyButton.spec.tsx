import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const copyToClipboard = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('./publish.utils', () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
const translator = { t: (key: string) => key }
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { CopyButton } = await import('./CopyButton')

beforeEach(() => {
  vi.clearAllMocks()
  copyToClipboard.mockResolvedValue(true)
})

describe('copyButton', () => {
  it('点一下复制内容并当场给反馈', async () => {
    render(<CopyButton text="正文正文" label="publish.card.copyBody" />)

    await userEvent.click(screen.getByRole('button', { name: /publish.card.copyBody/ }))

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith('正文正文'))
    expect(toastSuccess).toHaveBeenCalledWith('publish.card.copied')
    expect(await screen.findByText('publish.card.copied')).toBeInTheDocument()
  })

  it('复制不成功时说一声，按钮不变成已复制', async () => {
    copyToClipboard.mockResolvedValue(false)
    render(<CopyButton text="正文正文" label="publish.card.copyBody" />)

    await userEvent.click(screen.getByRole('button', { name: /publish.card.copyBody/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('publish.card.copyFailed'))
    expect(screen.queryByText('publish.card.copied')).not.toBeInTheDocument()
  })

  /** 没内容可复制时点了也没意义，直接禁用 */
  it('内容为空时按钮是灰的', () => {
    render(<CopyButton text="" label="publish.card.copyBody" />)

    expect(screen.getByRole('button', { name: /publish.card.copyBody/ })).toBeDisabled()
  })

  it('不传文字时只剩图标，无障碍名字用默认文案', () => {
    render(<CopyButton text="正文正文" />)

    expect(screen.getByRole('button', { name: 'publish.card.copy' })).toBeInTheDocument()
  })
})
