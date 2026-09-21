import type { ProjectDetail } from '@/api/projects/project.types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStatus } from '@/api/projects/project.types'

/** 文案键就是断言对象：这样用例不会因为改一句中文就红，改错了键照样能抓到 */
const translator = { t: (key: string) => key }
vi.mock('@/app/i18n/client', () => ({ useTransClient: () => translator }))

const { ProjectInfoCard } = await import('./index')

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p1',
    name: 'forty-weeks',
    displayName: '四十周',
    desc: null,
    audience: null,
    goal: null,
    status: ProjectStatus.Active,
    dirName: 'forty-weeks',
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

function renderCard(detail = project(), open = true) {
  const onOpenChange = vi.fn()
  const view = render(
    <ProjectInfoCard project={detail} open={open} onOpenChange={onOpenChange} />,
  )
  return { onOpenChange, ...view }
}

describe('projectInfoCard', () => {
  it('展开后把英文名、目录名和状态摆出来', () => {
    renderCard()

    // 没归档时英文名和目录名是同一个值，两处都要在
    expect(screen.getAllByText('forty-weeks')).toHaveLength(2)
    expect(screen.getByText('label.dirName')).toBeInTheDocument()
    expect(screen.getByText('status.active')).toBeInTheDocument()
    expect(screen.getByText('detail.nameFixed')).toBeInTheDocument()
  })

  /** 归档之后磁盘目录会被改名，这两个值就不一样了，得分别看得到 */
  it('归档项目的目录名和英文名分开显示，并多出归档时间', () => {
    renderCard(project({
      status: ProjectStatus.Archived,
      dirName: '_archived_forty-weeks_20260903000000',
      archivedAt: '2026-09-03T00:00:00.000Z',
    }))

    expect(screen.getByText('forty-weeks')).toBeInTheDocument()
    expect(screen.getByText('_archived_forty-weeks_20260903000000')).toBeInTheDocument()
    expect(screen.getByText('label.archivedAt')).toBeInTheDocument()
  })

  it('没归档时不显示归档时间', () => {
    renderCard()

    expect(screen.queryByText('label.archivedAt')).not.toBeInTheDocument()
  })

  it('收起状态下只剩标题', () => {
    renderCard(project(), false)

    expect(screen.getByText('detail.basicInfo')).toBeInTheDocument()
    expect(screen.queryByText('detail.nameFixed')).not.toBeInTheDocument()
  })

  it('点标题把展开状态交给详情页', async () => {
    const { onOpenChange } = renderCard()

    await userEvent.click(screen.getByTestId('project-basic-info-toggle'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
