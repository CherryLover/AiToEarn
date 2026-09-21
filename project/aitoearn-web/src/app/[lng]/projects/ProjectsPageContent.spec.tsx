import type { ProjectListItem } from '@/api/projects/project.types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStatus } from '@/api/projects/project.types'

const createProjectApi = vi.fn()
const getProjectListApi = vi.fn()
const suggestProjectNameApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/projects/project.api', () => ({
  createProjectApi: (...a: unknown[]) => createProjectApi(...a),
  getProjectListApi: (...a: unknown[]) => getProjectListApi(...a),
  suggestProjectNameApi: (...a: unknown[]) => suggestProjectNameApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/**
 * 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到。
 * 每次都返回同一个对象很关键：页面把 `t` 放进了 useCallback 的依赖，
 * 每渲染一次换一个新的 `t`，拉列表的 effect 就会一直重跑，整个用例转死在那儿。
 */
const translator = { t: (key: string) => key }
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => translator,
}))
vi.mock('@/hooks', () => ({ useDocumentTitle: () => {} }))
vi.mock('@/hooks/useSystem', () => ({ useGetClientLng: () => 'zh-CN' }))

const { ProjectsPageContent } = await import('./ProjectsPageContent')

function project(overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id: 'p1',
    name: 'forty-weeks',
    displayName: '四十周',
    desc: '孕期内容',
    status: ProjectStatus.Active,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as ProjectListItem
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getProjectListApi.mockResolvedValue({ code: 0, data: [project()] })
})

async function renderPage() {
  const view = render(<ProjectsPageContent />)
  await waitFor(() => expect(getProjectListApi).toHaveBeenCalled())
  return view
}

describe('projectsPageContent 列表', () => {
  it('默认只看进行中的项目', async () => {
    await renderPage()

    expect(getProjectListApi).toHaveBeenCalledWith(ProjectStatus.Active)
    expect(await screen.findByText('四十周')).toBeInTheDocument()
    expect(screen.getByText('forty-weeks')).toBeInTheDocument()
  })

  it('能切到归档视图再切回来', async () => {
    await renderPage()
    await screen.findByText('四十周')

    await userEvent.click(screen.getByRole('button', { name: /action.viewArchived/ }))
    await waitFor(() => expect(getProjectListApi).toHaveBeenLastCalledWith(ProjectStatus.Archived))

    await userEvent.click(screen.getByRole('button', { name: /action.viewActive/ }))
    await waitFor(() => expect(getProjectListApi).toHaveBeenLastCalledWith(ProjectStatus.Active))
  })

  it('一个项目都没有时给新建入口', async () => {
    getProjectListApi.mockResolvedValue({ code: 0, data: [] })
    await renderPage()

    expect(await screen.findByText('empty.title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /empty.action/ })).toBeInTheDocument()
  })

  /** 归档视图下没项目就是没归档过，不该再劝人新建 */
  it('归档视图为空时不给新建入口', async () => {
    getProjectListApi.mockResolvedValue({ code: 0, data: [] })
    await renderPage()

    await userEvent.click(screen.getByRole('button', { name: /action.viewArchived/ }))

    expect(await screen.findByText('emptyArchived.title')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /empty.action/ })).not.toBeInTheDocument()
  })

  it('拉列表失败时说一声', async () => {
    getProjectListApi.mockResolvedValue({ code: 20000, data: null })
    await renderPage()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('list.loadFailed'))
  })

  it('请求本身没通时也说一声', async () => {
    getProjectListApi.mockRejectedValue(new Error('offline'))
    await renderPage()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('list.loadFailed'))
  })

  it('刷新会重新拉一次', async () => {
    await renderPage()
    await screen.findByText('四十周')

    await userEvent.click(screen.getByRole('button', { name: /action.refresh/ }))

    await waitFor(() => expect(getProjectListApi).toHaveBeenCalledTimes(2))
  })
})

describe('projectsPageContent 新建项目', () => {
  async function openDialog() {
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: /action.create$/ }))
    return screen.findByRole('dialog')
  }

  it('英文名和显示名都填对了才让提交', async () => {
    const dialog = await openDialog()

    expect(within(dialog).getByRole('button', { name: /form.submit/ })).toBeDisabled()

    await userEvent.type(within(dialog).getByLabelText(/label.displayName/), '四十周')
    await userEvent.type(within(dialog).getByLabelText(/label.name/), 'forty-weeks')

    expect(within(dialog).getByRole('button', { name: /form.submit/ })).toBeEnabled()
  })

  /** 英文名同时是服务器上的目录名，大写和空格都不收 */
  it('英文名输进去就被收拾成小写', async () => {
    const dialog = await openDialog()

    await userEvent.type(within(dialog).getByLabelText(/label.name/), 'Forty-Weeks')

    expect(within(dialog).getByLabelText(/label.name/)).toHaveValue('forty-weeks')
  })

  it('英文名不合法时提交按钮是灰的', async () => {
    const dialog = await openDialog()

    await userEvent.type(within(dialog).getByLabelText(/label.displayName/), '四十周')
    await userEvent.type(within(dialog).getByLabelText(/label.name/), 'a')

    expect(within(dialog).getByRole('button', { name: /form.submit/ })).toBeDisabled()
  })

  it('建成功之后通知父级刷新', async () => {
    createProjectApi.mockResolvedValue({ code: 0, data: project() })
    const dialog = await openDialog()

    await userEvent.type(within(dialog).getByLabelText(/label.displayName/), '四十周')
    await userEvent.type(within(dialog).getByLabelText(/label.name/), 'forty-weeks')
    await userEvent.type(within(dialog).getByLabelText(/label.desc/), '孕期内容')
    await userEvent.click(within(dialog).getByRole('button', { name: /form.submit/ }))

    await waitFor(() => expect(createProjectApi).toHaveBeenCalledWith({
      name: 'forty-weeks',
      displayName: '四十周',
      desc: '孕期内容',
      audience: undefined,
      goal: undefined,
    }))
    expect(toastSuccess).toHaveBeenCalledWith('form.createSuccess')
    await waitFor(() => expect(getProjectListApi).toHaveBeenCalledTimes(2))
  })

  it('英文名被占用时把业务码翻成具体说法', async () => {
    createProjectApi.mockResolvedValue({ code: 20002 })
    const dialog = await openDialog()

    await userEvent.type(within(dialog).getByLabelText(/label.displayName/), '四十周')
    await userEvent.type(within(dialog).getByLabelText(/label.name/), 'forty-weeks')
    await userEvent.click(within(dialog).getByRole('button', { name: /form.submit/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('error.nameTaken'))
  })

  it('随机生成一个可用的英文名填进去', async () => {
    suggestProjectNameApi.mockResolvedValue({ code: 0, data: { name: 'quiet-otter' } })
    const dialog = await openDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: /form.suggest/ }))

    await waitFor(() => expect(within(dialog).getByLabelText(/label.name/)).toHaveValue('quiet-otter'))
  })

  it('生成不出来时说一声', async () => {
    suggestProjectNameApi.mockResolvedValue({ code: 20001, data: null })
    const dialog = await openDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: /form.suggest/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('form.suggestFailed'))
  })
})
