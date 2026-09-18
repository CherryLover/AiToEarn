import { ResponseCode, UserType } from '@yikart/common'
import { describe, expect, it, vi } from 'vitest'
import { ProjectsService } from './projects.service'

vi.mock('../../config', () => ({
  config: {
    projects: { root: '/data/projects' },
  },
}))

vi.mock('@yikart/mongodb', () => ({
  ProjectRepository: class ProjectRepository {},
  ProjectStatus: {
    ACTIVE: 'active',
    ARCHIVED: 'archived',
  },
}))

function createService(overrides: {
  projectRepository?: Record<string, unknown>
  projectDirService?: Record<string, unknown>
} = {}) {
  const projectRepository = {
    existsByName: vi.fn(async () => false),
    create: vi.fn(async (data: Record<string, unknown>) => ({ id: 'project-1', ...data })),
    getById: vi.fn(async () => null),
    updateById: vi.fn(async () => null),
    listByUserId: vi.fn(async () => []),
    ...overrides.projectRepository,
  }
  const projectDirService = {
    createProjectDir: vi.fn(async () => '/data/projects/fortyweeks'),
    removeProjectDir: vi.fn(async () => undefined),
    renameProjectDir: vi.fn(async () => true),
    refreshClaudeMd: vi.fn(async () => true),
    ...overrides.projectDirService,
  }
  const service = new ProjectsService(projectRepository as never, projectDirService as never)

  return { service, projectRepository, projectDirService }
}

interface ArchiveUpdate {
  dirName: string
  status: string
  archivedAt: Date
}

const activeProject = {
  id: 'project-1',
  userId: 'user-1',
  name: 'fortyweeks',
  displayName: '四十周',
  status: 'active',
  dirName: 'fortyweeks',
}

describe('projects service · 创建', () => {
  it('合法名字：先建目录再入库，目录名等于英文名', async () => {
    const { service, projectRepository, projectDirService } = createService()

    const project = await service.create('user-1', {
      name: 'fortyweeks',
      displayName: '四十周',
      desc: '记录工具',
    } as never)

    expect(projectDirService.createProjectDir).toHaveBeenCalledWith({
      name: 'fortyweeks',
      displayName: '四十周',
      desc: '记录工具',
      audience: undefined,
      goal: undefined,
    })
    expect(projectRepository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      userType: UserType.User,
      name: 'fortyweeks',
      displayName: '四十周',
      desc: '记录工具',
      audience: undefined,
      goal: undefined,
      status: 'active',
      dirName: 'fortyweeks',
    })
    expect(project).toMatchObject({ id: 'project-1', name: 'fortyweeks' })
  })

  it('非法名字：直接拒绝，不碰磁盘也不碰数据库', async () => {
    const { service, projectRepository, projectDirService } = createService()

    await expect(service.create('user-1', { name: 'Bad_Name', displayName: '四十周' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectNameInvalid })

    expect(projectDirService.createProjectDir).not.toHaveBeenCalled()
    expect(projectRepository.create).not.toHaveBeenCalled()
  })

  it('保留字：直接拒绝', async () => {
    const { service, projectDirService } = createService()

    await expect(service.create('user-1', { name: 'config', displayName: '配置' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectNameReserved })

    expect(projectDirService.createProjectDir).not.toHaveBeenCalled()
  })

  it('重名：拒绝，不建目录', async () => {
    const { service, projectDirService } = createService({
      projectRepository: { existsByName: vi.fn(async () => true) },
    })

    await expect(service.create('user-1', { name: 'fortyweeks', displayName: '四十周' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectNameTaken })

    expect(projectDirService.createProjectDir).not.toHaveBeenCalled()
  })

  it('入库失败：把已经建好的目录删掉', async () => {
    const { service, projectDirService } = createService({
      projectRepository: {
        create: vi.fn(async () => {
          throw new Error('mongo down')
        }),
      },
    })

    await expect(service.create('user-1', { name: 'fortyweeks', displayName: '四十周' } as never))
      .rejects
      .toThrow('mongo down')

    expect(projectDirService.removeProjectDir).toHaveBeenCalledWith('fortyweeks')
  })

  it('并发撞唯一索引：删目录并按重名报错', async () => {
    const { service, projectDirService } = createService({
      projectRepository: {
        create: vi.fn(async () => {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
        }),
      },
    })

    await expect(service.create('user-1', { name: 'fortyweeks', displayName: '四十周' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectNameTaken })

    expect(projectDirService.removeProjectDir).toHaveBeenCalledWith('fortyweeks')
  })
})

describe('projects service · 更新与归档', () => {
  it('只更新白名单字段，英文名改不了', async () => {
    const { service, projectRepository } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject })),
        updateById: vi.fn(async () => ({ ...activeProject, displayName: '四十周孕期' })),
      },
    })

    await service.update('project-1', 'user-1', { displayName: '四十周孕期', name: 'hacked' } as never)

    expect(projectRepository.updateById).toHaveBeenCalledWith('project-1', { displayName: '四十周孕期' })
  })

  it('更新成功后按最新信息重写磁盘上的 CLAUDE.md', async () => {
    const { service, projectDirService } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject })),
        updateById: vi.fn(async () => ({
          ...activeProject,
          displayName: '四十周孕期',
          desc: '新的说明',
          audience: '新的受众',
          goal: '新的目标',
        })),
      },
    })

    await service.update('project-1', 'user-1', { displayName: '四十周孕期' } as never)

    expect(projectDirService.refreshClaudeMd).toHaveBeenCalledWith('fortyweeks', {
      name: 'fortyweeks',
      displayName: '四十周孕期',
      desc: '新的说明',
      audience: '新的受众',
      goal: '新的目标',
    })
  })

  it('没有任何字段要改时，不动数据库也不重写 CLAUDE.md', async () => {
    const { service, projectRepository, projectDirService } = createService({
      projectRepository: { getById: vi.fn(async () => ({ ...activeProject })) },
    })

    await service.update('project-1', 'user-1', {} as never)

    expect(projectRepository.updateById).not.toHaveBeenCalled()
    expect(projectDirService.refreshClaudeMd).not.toHaveBeenCalled()
  })

  it('重写 CLAUDE.md 失败不影响更新结果', async () => {
    const { service } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject })),
        updateById: vi.fn(async () => ({ ...activeProject, displayName: '四十周孕期' })),
      },
      projectDirService: { refreshClaudeMd: vi.fn(async () => false) },
    })

    await expect(service.update('project-1', 'user-1', { displayName: '四十周孕期' } as never))
      .resolves
      .toMatchObject({ displayName: '四十周孕期' })
  })

  it('已归档的项目不重写 CLAUDE.md', async () => {
    const { service, projectDirService } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject, status: 'archived' })),
      },
    })

    await expect(service.update('project-1', 'user-1', { displayName: '新名字' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectArchived })

    expect(projectDirService.refreshClaudeMd).not.toHaveBeenCalled()
  })

  it('别人的项目查不到', async () => {
    const { service } = createService({
      projectRepository: { getById: vi.fn(async () => ({ ...activeProject, userId: 'user-2' })) },
    })

    await expect(service.getDetail('project-1', 'user-1'))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectNotFound })
  })

  it('已归档的项目不能改', async () => {
    const { service } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject, status: 'archived' })),
      },
    })

    await expect(service.update('project-1', 'user-1', { displayName: '新名字' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectArchived })
  })

  it('归档：目录改名成 _archived_<名>_<时间戳>，状态和时间一起落库', async () => {
    const updateById = vi.fn(async () => ({ ...activeProject, status: 'archived' }))
    const { service, projectDirService } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject })),
        updateById,
      },
    })

    await service.archive('project-1', 'user-1')

    expect(projectDirService.renameProjectDir).toHaveBeenCalledTimes(1)
    const renameCalls = projectDirService.renameProjectDir.mock.calls as unknown as [string, string][]
    const [fromDir, toDir] = renameCalls[0]!
    expect(fromDir).toBe('fortyweeks')
    expect(toDir).toMatch(/^_archived_fortyweeks_\d{14}$/)

    const updateCalls = updateById.mock.calls as unknown as [string, ArchiveUpdate][]
    const update = updateCalls[0]![1]
    expect(update.dirName).toBe(toDir)
    expect(update.status).toBe('archived')
    expect(update.archivedAt).toBeInstanceOf(Date)
  })

  it('归档已归档的项目：拒绝，不改目录', async () => {
    const { service, projectDirService } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject, status: 'archived' })),
      },
    })

    await expect(service.archive('project-1', 'user-1'))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectArchived })

    expect(projectDirService.renameProjectDir).not.toHaveBeenCalled()
  })

  it('归档入库失败：目录名改回去', async () => {
    const { service, projectDirService } = createService({
      projectRepository: {
        getById: vi.fn(async () => ({ ...activeProject })),
        updateById: vi.fn(async () => {
          throw new Error('mongo down')
        }),
      },
    })

    await expect(service.archive('project-1', 'user-1')).rejects.toThrow('mongo down')

    expect(projectDirService.renameProjectDir).toHaveBeenCalledTimes(2)
    const renameCalls = projectDirService.renameProjectDir.mock.calls as unknown as [string, string][]
    const [secondFrom, secondTo] = renameCalls[1]!
    expect(secondFrom).toMatch(/^_archived_fortyweeks_\d{14}$/)
    expect(secondTo).toBe('fortyweeks')
  })
})

describe('projects service · 建议名', () => {
  it('返回可读的组合词，不是 uuid', async () => {
    const { service } = createService()

    const name = await service.suggestName()

    expect(name).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('连续撞名 10 次就在末尾加数字', async () => {
    let calls = 0
    const { service } = createService({
      projectRepository: {
        existsByName: vi.fn(async () => {
          calls += 1
          return calls <= 10
        }),
      },
    })

    const name = await service.suggestName()

    expect(name).toMatch(/^[a-z]+-[a-z]+-2$/)
  })
})
