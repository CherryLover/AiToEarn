import type { ProjectDetail } from '@/api/projects/project.types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStatus } from '@/api/projects/project.types'

const updateProjectApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/projects/project.api', () => ({
  updateProjectApi: (...a: unknown[]) => updateProjectApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
const translator = { t: (key: string) => key }
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { ProjectSettingsForm } = await import('./index')

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p1',
    name: 'forty-weeks',
    displayName: '四十周',
    desc: '孕期内容',
    audience: null,
    goal: null,
    status: ProjectStatus.Active,
    dirName: 'forty-weeks',
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function renderForm(detail = project(), disabled = false) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  const view = render(
    <ProjectSettingsForm
      project={detail}
      onSaved={onSaved}
      disabled={disabled}
      open
      onOpenChange={onOpenChange}
    />,
  )
  return { onSaved, onOpenChange, ...view }
}

describe('projectSettingsForm 展示', () => {
  it('把当前的显示名和说明填好，没填过的留空', () => {
    renderForm()

    expect(screen.getByLabelText(/label.displayName/)).toHaveValue('四十周')
    expect(screen.getByLabelText(/label.desc/)).toHaveValue('孕期内容')
    expect(screen.getByLabelText(/label.audience/)).toHaveValue('')
    expect(screen.getByLabelText(/label.goal/)).toHaveValue('')
  })

  it('收起状态下不显示表单', () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ProjectSettingsForm
        project={project()}
        onSaved={onSaved}
        open={false}
        onOpenChange={onOpenChange}
      />,
    )

    expect(screen.queryByLabelText(/label.displayName/)).not.toBeInTheDocument()
  })

  it('点标题把展开状态交给详情页', async () => {
    const { onOpenChange } = renderForm()

    await userEvent.click(screen.getByTestId('project-settings-toggle'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  /** 详情页重新拉过之后表单得跟着换，不然人看到的还是旧值 */
  it('详情换了之后表单跟着换', () => {
    const { rerender, onSaved, onOpenChange } = renderForm()

    rerender(
      <ProjectSettingsForm
        project={project({ displayName: '四十周 2.0', audience: '孕妈' })}
        onSaved={onSaved}
        open
        onOpenChange={onOpenChange}
      />,
    )

    expect(screen.getByLabelText(/label.displayName/)).toHaveValue('四十周 2.0')
    expect(screen.getByLabelText(/label.audience/)).toHaveValue('孕妈')
  })
})

describe('projectSettingsForm 保存', () => {
  it('没改之前保存和重置都是灰的', () => {
    renderForm()

    expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /detail.reset/ })).toBeDisabled()
  })

  it('改完保存，四个字段都去掉两头空格一起提交', async () => {
    const saved = project({ displayName: '四十周 2.0' })
    updateProjectApi.mockResolvedValue({ code: 0, data: saved })
    const { onSaved } = renderForm()

    await userEvent.type(screen.getByLabelText(/label.audience/), '  孕妈  ')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(updateProjectApi).toHaveBeenCalledWith('p1', {
      displayName: '四十周',
      desc: '孕期内容',
      audience: '孕妈',
      goal: '',
    }))
    expect(toastSuccess).toHaveBeenCalledWith('detail.saveSuccess')
    expect(onSaved).toHaveBeenCalledWith(saved)
  })

  it('显示名清空时提示并不让保存', async () => {
    renderForm()

    await userEvent.clear(screen.getByLabelText(/label.displayName/))

    expect(screen.getByText('displayNameError.required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled()
  })

  it('重置把改动丢掉', async () => {
    renderForm()

    await userEvent.type(screen.getByLabelText(/label.goal/), '涨粉')
    await userEvent.click(screen.getByRole('button', { name: /detail.reset/ }))

    expect(screen.getByLabelText(/label.goal/)).toHaveValue('')
    expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled()
  })

  it('保存失败时把业务码翻成具体说法', async () => {
    updateProjectApi.mockResolvedValue({ code: 20000 })
    const { onSaved } = renderForm()

    await userEvent.type(screen.getByLabelText(/label.goal/), '涨粉')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.notFound'))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('请求本身没通时说不出所以然', async () => {
    updateProjectApi.mockRejectedValue(new Error('offline'))
    renderForm()

    await userEvent.type(screen.getByLabelText(/label.goal/), '涨粉')
    await userEvent.click(screen.getByRole('button', { name: /detail.save/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.unknown'))
  })

  /** 归档项目只读：字段能看，但一个都改不了 */
  it('只读时输入框和按钮全禁用', () => {
    renderForm(project({ status: ProjectStatus.Archived }), true)

    expect(screen.getByLabelText(/label.displayName/)).toBeDisabled()
    expect(screen.getByLabelText(/label.desc/)).toBeDisabled()
    expect(screen.getByRole('button', { name: /detail.save/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /detail.reset/ })).toBeDisabled()
  })
})
