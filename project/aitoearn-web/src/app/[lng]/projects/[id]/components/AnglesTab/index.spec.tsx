import type { Angle } from '@/api/angles/angle.types'
import { chooseOption } from '@test/radix'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AngleSource, AngleStatus } from '@/api/angles/angle.types'

const createAngleApi = vi.fn()
const deleteAngleApi = vi.fn()
const deriveAngleApi = vi.fn()
const getAngleListApi = vi.fn()
const syncAnglesApi = vi.fn()
const updateAngleApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/angles/angle.api', () => ({
  createAngleApi: (...a: unknown[]) => createAngleApi(...a),
  deleteAngleApi: (...a: unknown[]) => deleteAngleApi(...a),
  deriveAngleApi: (...a: unknown[]) => deriveAngleApi(...a),
  getAngleListApi: (...a: unknown[]) => getAngleListApi(...a),
  syncAnglesApi: (...a: unknown[]) => syncAnglesApi(...a),
  updateAngleApi: (...a: unknown[]) => updateAngleApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))
/** 「让 AI 提炼方向」现在只是把一句话丢给右侧对话，用例靠它断言丢了什么 */
const onAskAi = vi.fn()
/** 交代完生成之后要求切到「生成」页 */
const onGoToDrafts = vi.fn()
/** 最近一次提炼任务的「跑完」回调，用例靠它模拟 Agent 跑完 */
let onAgentDone: (() => void) | null = null
vi.mock('@/api/ai/ai.api', () => ({
  agentApi: {
    abortTask: vi.fn(),
    createTaskWithSSE: (_p: unknown, _m: unknown, _e: unknown, done: () => void) => {
      onAgentDone = done
      return Promise.resolve(() => {})
    },
  },
}))

const { AnglesTab } = await import('./index')

function angle(overrides: Partial<Angle> & Pick<Angle, 'id' | 'slug'>): Angle {
  return {
    projectId: 'p1',
    name: overrides.slug,
    desc: null,
    source: AngleSource.User,
    parentAngleId: null,
    status: AngleStatus.Candidate,
    sourceAssetPaths: null,
    promptSnapshot: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getAngleListApi.mockResolvedValue({ code: 0, data: [] })
  onAgentDone = null
})

async function renderTab(readOnly = false) {
  const view = render(
    <AnglesTab
      projectId="p1"
      projectName="forty-weeks"
      readOnly={readOnly}
      onAskAi={onAskAi}
      onGoToDrafts={onGoToDrafts}
      refreshSignal={0}
    />,
  )
  await waitFor(() => expect(getAngleListApi).toHaveBeenCalled())

  /** 模拟页面「对话跑完一轮」：把 refreshSignal 往上加 */
  const bumpSignal = async (signal: number) => {
    view.rerender(
      <AnglesTab
        projectId="p1"
        projectName="forty-weeks"
        readOnly={readOnly}
        onAskAi={onAskAi}
        onGoToDrafts={onGoToDrafts}
        refreshSignal={signal}
      />,
    )
  }

  return { ...view, bumpSignal }
}

describe('anglesTab 空状态与失败', () => {
  it('一个方向都没有时给出两条出路', async () => {
    await renderTab()

    expect(await screen.findByText('angles.empty.title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /angles.empty.extract/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /angles.empty.create/ })).toBeInTheDocument()
  })

  /** 归档项目只读：还能看，但不能再建 */
  it('归档项目里不给建方向的入口', async () => {
    await renderTab(true)

    expect(await screen.findByText('angles.empty.title')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /angles.empty.create/ })).not.toBeInTheDocument()
  })

  it('加载失败时给重试按钮', async () => {
    getAngleListApi.mockResolvedValue({ code: 20200, data: null })
    await renderTab()

    expect(await screen.findByText('angles.loadFailed')).toBeInTheDocument()
    getAngleListApi.mockResolvedValue({ code: 0, data: [] })

    await userEvent.click(screen.getByRole('button', { name: /action.retry/ }))

    await waitFor(() => expect(screen.getByText('angles.empty.title')).toBeInTheDocument())
  })
})

describe('anglesTab 两种看法', () => {
  beforeEach(() => {
    getAngleListApi.mockResolvedValue({
      code: 0,
      data: [
        angle({ id: 'root', slug: 'pain-point', name: '孕晚期焦虑' }),
        angle({ id: 'child', slug: 'pain-point-2', name: '待产包', parentAngleId: 'root', status: AngleStatus.Effective }),
      ],
    })
  })

  it('默认看演进树，两个方向都在', async () => {
    await renderTab()

    expect(await screen.findByText('孕晚期焦虑')).toBeInTheDocument()
    expect(screen.getByText('待产包')).toBeInTheDocument()
  })

  it('能切成按状态分组', async () => {
    await renderTab()
    await screen.findByText('孕晚期焦虑')

    await userEvent.click(screen.getByRole('button', { name: /angles.view.status/ }))

    expect(screen.getByText('孕晚期焦虑')).toBeInTheDocument()
    expect(screen.getByText('待产包')).toBeInTheDocument()
  })
})

describe('anglesTab 建方向', () => {
  it('建成功后提示一声并重拉列表', async () => {
    createAngleApi.mockResolvedValue({ code: 0, data: angle({ id: 'a1', slug: 'pain-point' }) })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.empty.create/ }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/angles.form.slugLabel/), 'pain-point')
    await userEvent.type(within(dialog).getByLabelText(/angles.form.nameLabel/), '孕晚期焦虑')
    await userEvent.click(within(dialog).getByRole('button', { name: /action.save|angles.form.submit|action.confirm/ }))

    await waitFor(() => expect(createAngleApi).toHaveBeenCalledWith('p1', expect.objectContaining({ slug: 'pain-point', name: '孕晚期焦虑' })))
    expect(toastSuccess).toHaveBeenCalledWith('angles.form.createSuccess')
  })

  /** slug 撞车这类失败要把服务端的业务码翻成具体说法，不能只说「失败了」 */
  it('建失败时把业务码翻成具体说法', async () => {
    createAngleApi.mockResolvedValue({ code: 20202 })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.empty.create/ }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/angles.form.slugLabel/), 'pain-point')
    await userEvent.type(within(dialog).getByLabelText(/angles.form.nameLabel/), '孕晚期焦虑')
    await userEvent.click(within(dialog).getByRole('button', { name: /action.save|angles.form.submit|action.confirm/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('angles.error.slugTaken'))
  })
})

describe('anglesTab 加一个方向', () => {
  /**
   * 心里有个影子的时候最缺的是有人追问两句。直接甩一张空表单，
   * 人只会把那个还没想清楚的影子原样填进去。
   */
  it('主入口走对话，不弹表单', async () => {
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /angles.action.create$/ }))

    expect(onAskAi).toHaveBeenCalledTimes(1)
    const prompt = onAskAi.mock.calls[0][0] as string
    expect(prompt).toContain('先别写文件')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /** 想清楚了不想聊的，还是得能直接写 */
  it('旁边留着自己写的入口', async () => {
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /angles.empty.create/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(onAskAi).not.toHaveBeenCalled()
  })
})

describe('anglesTab 删方向', () => {
  beforeEach(() => {
    getAngleListApi.mockResolvedValue({ code: 0, data: [angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑' })] })
  })

  it('删之前先确认，确认之后才真的删', async () => {
    deleteAngleApi.mockResolvedValue({ code: 0, data: {} })
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /angles.action.delete/ }))
    expect(await screen.findByText('angles.delete.title')).toBeInTheDocument()
    expect(deleteAngleApi).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /angles.delete.confirm|action.confirm|action.delete/ }))

    await waitFor(() => expect(deleteAngleApi).toHaveBeenCalledWith('p1', 'a1'))
    expect(toastSuccess).toHaveBeenCalledWith('angles.delete.success')
  })

  /** 还有子方向时服务端会拒，得把原因说出来 */
  it('删失败时把业务码翻成具体说法', async () => {
    deleteAngleApi.mockResolvedValue({ code: 20211 })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.action.delete/ }))

    await userEvent.click(await screen.findByRole('button', { name: /angles.delete.confirm|action.confirm|action.delete/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('angles.error.hasChildren'))
  })
})

/**
 * AI 提炼完只是把 angles/<slug>.md 写进了项目目录，数据库里还是空的。
 * 先登记（/angles/sync）再看列表——少了这一步，提炼完页面照样是空的。
 */
describe('anglesTab 让 AI 提炼方向', () => {
  /** 提炼不再自己起任务：它只是把一句话丢进右侧那条项目对话 */
  it('点提炼把提示词丢给对话，不弹窗', async () => {
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /angles.empty.extract/ }))

    expect(onAskAi).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /** 人多半是先聊了一阵才点这个按钮，提示词不圈住前面聊的，AI 会当成全新任务从头来 */
  it('提示词里点明要吃这条对话里已经聊到的东西', async () => {
    await renderTab()

    await userEvent.click(await screen.findByRole('button', { name: /angles.empty.extract/ }))

    const prompt = onAskAi.mock.calls[0][0] as string
    expect(prompt).toContain('这条对话里已经聊到的')
    expect(prompt).toContain('extracting-angles')
  })
})

describe('anglesTab 对话跑完之后的登记', () => {
  /** 少了这一步，AI 写完文件页面照样是空的 */
  it('跑完先登记再看列表', async () => {
    syncAnglesApi.mockResolvedValue({ code: 0, data: [angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑' })] })
    const { bumpSignal } = await renderTab()

    await act(async () => {
      await bumpSignal(1)
    })

    await waitFor(() => expect(syncAnglesApi).toHaveBeenCalledWith('p1'))
    expect(toastError).not.toHaveBeenCalled()
  })

  /** 登记失败要说清楚，并且退回去重拉一次，免得页面停在跑之前的旧列表上 */
  it('登记失败时说明原因并重拉列表', async () => {
    syncAnglesApi.mockResolvedValue({ code: 20200 })
    const before = getAngleListApi.mock.calls.length
    const { bumpSignal } = await renderTab()

    await act(async () => {
      await bumpSignal(1)
    })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('angles.error.notFound'))
    expect(getAngleListApi.mock.calls.length).toBeGreaterThan(before)
  })

  /** 初始那次渲染不该白跑一次登记 */
  it('刚进页面不会白登记一次', async () => {
    await renderTab()

    expect(syncAnglesApi).not.toHaveBeenCalled()
  })
})

describe('anglesTab 照这个方向写一条', () => {
  async function renderWithAngle() {
    getAngleListApi.mockResolvedValue({
      code: 0,
      data: [angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑' })],
    })
    return renderTab()
  }

  /** 方向定了，下一步就是照它写一条——不给这个入口，人得切到「生成」页把方向再选一遍 */
  it('点生成弹出小框，方向是带过来的', async () => {
    await renderWithAngle()

    await userEvent.click(await screen.findByRole('button', { name: /angles.action.generate/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('drafts.generate.dialogTitle')).toBeInTheDocument()
    // 方向名摆出来给人确认一眼
    expect(screen.getAllByText(/孕晚期焦虑/).length).toBeGreaterThan(0)
  })

  it('确认之后把话丢给对话，并要求切到生成页', async () => {
    await renderWithAngle()

    await userEvent.click(await screen.findByRole('button', { name: /angles.action.generate/ }))
    await userEvent.click(await screen.findByRole('button', { name: /drafts.generate.submit/ }))

    expect(onAskAi).toHaveBeenCalledTimes(1)
    const prompt = onAskAi.mock.calls[0][0] as string
    expect(prompt).toContain('pain-point')
    expect(prompt).toContain('drafting-post')
    expect(onGoToDrafts).toHaveBeenCalledTimes(1)
  })

  /** 淘汰的方向不该再拿去生成，口径和「生成」页的方向下拉一致 */
  it('淘汰的方向不给生成入口', async () => {
    getAngleListApi.mockResolvedValue({
      code: 0,
      data: [angle({ id: 'a1', slug: 'dead-end', name: '试过不行', status: AngleStatus.Retired })],
    })
    await renderTab()

    expect(await screen.findByText(/试过不行/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /angles.action.generate/ })).not.toBeInTheDocument()
  })

  it('归档项目里不给生成', async () => {
    getAngleListApi.mockResolvedValue({
      code: 0,
      data: [angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑' })],
    })
    await renderTab(true)

    expect(await screen.findByText(/孕晚期焦虑/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /angles.action.generate/ })).not.toBeInTheDocument()
  })
})

describe('anglesTab 从一个方向往下深入', () => {
  beforeEach(() => {
    getAngleListApi.mockResolvedValue({ code: 0, data: [angle({ id: 'root', slug: 'pain-point', name: '孕晚期焦虑' })] })
  })

  /** 派生表单的 slug 预填成父 slug 的下一个序号，人不用自己想 */
  it('派生时预填子 slug，成功后提示', async () => {
    deriveAngleApi.mockResolvedValue({ code: 0, data: angle({ id: 'child', slug: 'pain-point-2' }) })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.action.derive/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/angles.form.slugLabel/)).toHaveValue('pain-point-2')

    await userEvent.type(within(dialog).getByLabelText(/angles.form.nameLabel/), '待产包')
    await userEvent.click(within(dialog).getByRole('button', { name: /angles.form.submitDerive/ }))

    await waitFor(() => expect(deriveAngleApi).toHaveBeenCalledWith('p1', 'root', expect.objectContaining({ slug: 'pain-point-2', name: '待产包' })))
    expect(toastSuccess).toHaveBeenCalledWith('angles.form.deriveSuccess')
  })

  it('派生失败时把业务码翻成具体说法', async () => {
    deriveAngleApi.mockResolvedValue({ code: 20202 })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.action.derive/ }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText(/angles.form.nameLabel/), '待产包')
    await userEvent.click(within(dialog).getByRole('button', { name: /angles.form.submitDerive/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('angles.error.slugTaken'))
  })
})

describe('anglesTab 改方向', () => {
  beforeEach(() => {
    getAngleListApi.mockResolvedValue({
      code: 0,
      data: [angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑', desc: '切孕晚期的焦虑' })],
    })
  })

  /** slug 是文件名，建完就不许改了，只能改名字和说明 */
  it('编辑时 slug 锁死，只提交名字和说明', async () => {
    updateAngleApi.mockResolvedValue({ code: 0, data: angle({ id: 'a1', slug: 'pain-point' }) })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.action.edit/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/angles.form.slugLabel/)).toBeDisabled()

    const nameInput = within(dialog).getByLabelText(/angles.form.nameLabel/)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '孕晚期的钱')
    await userEvent.click(within(dialog).getByRole('button', { name: /angles.form.submitSave/ }))

    await waitFor(() => expect(updateAngleApi).toHaveBeenCalledWith('p1', 'a1', {
      name: '孕晚期的钱',
      desc: '切孕晚期的焦虑',
      status: AngleStatus.Candidate,
    }))
    expect(toastSuccess).toHaveBeenCalledWith('angles.form.saveSuccess')
  })

  it('改名失败时把业务码翻成具体说法', async () => {
    updateAngleApi.mockResolvedValue({ code: 20200 })
    await renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /angles.action.edit/ }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /angles.form.submitSave/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('angles.error.notFound'))
  })

  /** 卡片上的状态下拉就地改，不用进表单 */
  it('卡片上直接改状态', async () => {
    updateAngleApi.mockResolvedValue({ code: 0, data: angle({ id: 'a1', slug: 'pain-point', status: AngleStatus.Testing }) })
    await renderTab()

    await chooseOption(
      await screen.findByRole('combobox', { name: /angles.form.statusLabel/ }),
      `angles.status.${AngleStatus.Testing}`,
    )

    await waitFor(() => expect(updateAngleApi).toHaveBeenCalledWith('p1', 'a1', { status: AngleStatus.Testing }))
    expect(toastSuccess).toHaveBeenCalledWith('angles.statusChange.success')
  })

  /** 选回当前状态什么都不该发生，别白发一次请求 */
  it('选回原来的状态不发请求', async () => {
    await renderTab()

    await chooseOption(
      await screen.findByRole('combobox', { name: /angles.form.statusLabel/ }),
      `angles.status.${AngleStatus.Candidate}`,
    )

    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument())
    expect(updateAngleApi).not.toHaveBeenCalled()
  })
})
