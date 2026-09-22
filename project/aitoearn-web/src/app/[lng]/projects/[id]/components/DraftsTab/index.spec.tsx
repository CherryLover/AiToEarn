import type { Angle } from '@/api/angles/angle.types'
import type { FileNode } from '@/api/projects/project-file.types'
import { chooseOption, openSelect } from '@test/radix'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AngleSource, AngleStatus } from '@/api/angles/angle.types'
import { ProjectFileType } from '@/api/projects/project-file.types'

const getAngleListApi = vi.fn()
const getProjectFileTreeApi = vi.fn()
const readProjectFileApi = vi.fn()
const writeProjectFileApi = vi.fn()
const downloadProjectFileApi = vi.fn()

/** 最近一次生成任务的「跑完」回调，用例靠它模拟 Agent 跑完 */
let onAgentDone: (() => void) | null = null
let agentParams: unknown = null

vi.mock('@/api/angles/angle.api', () => ({
  createAngleApi: vi.fn(),
  deleteAngleApi: vi.fn(),
  deriveAngleApi: vi.fn(),
  getAngleListApi: (...a: unknown[]) => getAngleListApi(...a),
  syncAnglesApi: vi.fn(),
  updateAngleApi: vi.fn(),
}))
vi.mock('@/api/projects/project-file.api', () => ({
  downloadProjectFileApi: (...a: unknown[]) => downloadProjectFileApi(...a),
  getProjectFileTreeApi: (...a: unknown[]) => getProjectFileTreeApi(...a),
  readProjectFileApi: (...a: unknown[]) => readProjectFileApi(...a),
  writeProjectFileApi: (...a: unknown[]) => writeProjectFileApi(...a),
}))
vi.mock('@/api/ai/ai.api', () => ({
  agentApi: {
    abortTask: vi.fn(),
    createTaskWithSSE: (params: unknown, _m: unknown, _e: unknown, done: () => void) => {
      agentParams = params
      onAgentDone = done
      return Promise.resolve(() => {})
    },
  },
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t: (key: string) => key }),
}))

const { DraftsTab } = await import('./index')

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

function dir(path: string, children: FileNode[] | null): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.Dir, size: null, updatedAt: '2026-09-01T00:00:00.000Z', children }
}
function file(path: string): FileNode {
  return { name: path.split('/').pop() ?? '', path, type: ProjectFileType.File, size: 20, updatedAt: '2026-09-01T00:00:00.000Z', children: null }
}

/** drafts/ 下一个标准草稿目录：正文 + 血缘 */
function draftsTree() {
  return dir('drafts', [
    dir('drafts/20260901-xhs-pain', [
      file('drafts/20260901-xhs-pain/content.md'),
      file('drafts/20260901-xhs-pain/meta.json'),
    ]),
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  onAgentDone = null
  agentParams = null
  getAngleListApi.mockResolvedValue({ code: 0, data: [angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑' })] })
  getProjectFileTreeApi.mockResolvedValue({ code: 0, data: draftsTree() })
  readProjectFileApi.mockResolvedValue({ code: 0, data: { path: 'x', content: '# 标题\n正文', size: 10, updatedAt: '2026-09-01T00:00:00.000Z' } })
})

/** 生成现在只是把一句话丢给右侧对话，用例靠它断言丢了什么 */
const onAskAi = vi.fn()

async function renderTab(readOnly = false) {
  const view = render(
    <DraftsTab
      projectId="p1"
      projectName="forty-weeks"
      readOnly={readOnly}
      onAskAi={onAskAi}
      refreshSignal={0}
    />,
  )
  await waitFor(() => expect(getProjectFileTreeApi).toHaveBeenCalled())
  return view
}

describe('draftsTab 草稿列表', () => {
  it('把 drafts/ 下的草稿列出来', async () => {
    await renderTab()

    expect(await screen.findByText('20260901-xhs-pain')).toBeInTheDocument()
    expect(screen.getByText('drafts.list.pickTitle')).toBeInTheDocument()
  })

  it('一条草稿都没有时给出说明', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: 0, data: dir('drafts', []) })
    await renderTab()

    expect(await screen.findByText('drafts.empty.title')).toBeInTheDocument()
  })

  /** drafts 目录还没建出来不算出错，就是还没生成过内容 */
  it('drafts 目录还没建出来时当成空列表，不是失败', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: 20100, data: null })
    await renderTab()

    expect(await screen.findByText('drafts.empty.title')).toBeInTheDocument()
    expect(screen.queryByText('drafts.list.loadFailed')).not.toBeInTheDocument()
  })

  it('拉列表失败时给重试按钮', async () => {
    getProjectFileTreeApi.mockResolvedValue({ code: 20101, data: null })
    await renderTab()

    expect(await screen.findByText('drafts.list.loadFailed')).toBeInTheDocument()
    getProjectFileTreeApi.mockResolvedValue({ code: 0, data: draftsTree() })

    await userEvent.click(screen.getByRole('button', { name: /action.retry/ }))

    expect(await screen.findByText('20260901-xhs-pain')).toBeInTheDocument()
  })

  it('点一条草稿就读它的正文', async () => {
    await renderTab()

    await userEvent.click(await screen.findByText('20260901-xhs-pain'))

    await waitFor(() => expect(readProjectFileApi).toHaveBeenCalledWith('p1', 'drafts/20260901-xhs-pain/content.md'))
  })
})

describe('draftsTab 生成一条内容', () => {
  it('没有可用方向时让人先去提炼', async () => {
    getAngleListApi.mockResolvedValue({ code: 0, data: [] })
    await renderTab()

    expect(await screen.findByText('drafts.generate.noAngles')).toBeInTheDocument()
  })

  /** 淘汰掉的方向不该再拿去生成内容 */
  it('淘汰的方向不出现在下拉里', async () => {
    getAngleListApi.mockResolvedValue({
      code: 0,
      data: [
        angle({ id: 'a1', slug: 'pain-point', name: '孕晚期焦虑' }),
        angle({ id: 'a2', slug: 'dead-end', name: '试过不行', status: AngleStatus.Retired }),
      ],
    })
    await renderTab()

    await openSelect(await screen.findByLabelText(/drafts.generate.angleLabel/))
    expect(await screen.findByRole('option', { name: /孕晚期焦虑/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /试过不行/ })).not.toBeInTheDocument()
  })

  /** 生成不再自己起任务：它只是把拼好的一句话丢进右侧那条项目对话 */
  it('选好方向才让生成，丢给对话的话里带着方向和项目名', async () => {
    await renderTab()

    expect(screen.getByRole('button', { name: /drafts.generate.submit/ })).toBeDisabled()

    await chooseOption(await screen.findByLabelText(/drafts.generate.angleLabel/), /孕晚期焦虑/)
    await userEvent.click(screen.getByRole('button', { name: /drafts.generate.submit/ }))

    expect(onAskAi).toHaveBeenCalledTimes(1)
    const prompt = onAskAi.mock.calls[0][0] as string
    expect(prompt).toContain('pain-point')
    expect(prompt).toContain('forty-weeks')
  })

  /** 过程在对话里，这张卡片不再自己转圈、也不再有停止按钮 */
  it('卡片里不再有运行中和停止', async () => {
    await renderTab()

    await chooseOption(await screen.findByLabelText(/drafts.generate.angleLabel/), /孕晚期焦虑/)
    await userEvent.click(screen.getByRole('button', { name: /drafts.generate.submit/ }))

    expect(screen.queryByRole('button', { name: /drafts.generate.running/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drafts.generate.stop/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /drafts.generate.submit/ })).toBeEnabled()
  })

  /** 对话跑完一轮，页面把 refreshSignal 加一，草稿列表要跟着重列 */
  it('对话跑完之后重新列一遍草稿', async () => {
    const view = await renderTab()

    const before = getProjectFileTreeApi.mock.calls.length
    await act(async () => {
      view.rerender(
        <DraftsTab
          projectId="p1"
          projectName="forty-weeks"
          readOnly={false}
          onAskAi={onAskAi}
          refreshSignal={1}
        />,
      )
    })

    await waitFor(() => expect(getProjectFileTreeApi.mock.calls.length).toBeGreaterThan(before))
  })

  /** 归档项目只读：草稿还能看，但不给再生成 */
  it('归档项目里不给生成', async () => {
    await renderTab(true)

    expect(await screen.findByRole('button', { name: /drafts.generate.submit/ })).toBeDisabled()
  })
})
