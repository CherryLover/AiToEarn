import { AppException, ResponseCode, UserType } from '@yikart/common'
import { describe, expect, it, vi } from 'vitest'
import { AnglesService } from './angles.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/data/projects' } },
}))

vi.mock('@yikart/mongodb', () => ({
  Angle: class Angle {},
  AngleRepository: class AngleRepository {},
  AngleSource: { AI: 'ai', USER: 'user', DERIVED: 'derived' },
  AngleStatus: { CANDIDATE: 'candidate', TESTING: 'testing', EFFECTIVE: 'effective', RETIRED: 'retired' },
  ProjectRepository: class ProjectRepository {},
  ProjectStatus: { ACTIVE: 'active', ARCHIVED: 'archived' },
}))

const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'
const ANGLE_A = '68c4b3f0a1b2c3d4e5f60001'
const ANGLE_B = '68c4b3f0a1b2c3d4e5f60002'
const ANGLE_C = '68c4b3f0a1b2c3d4e5f60003'
const NOW = new Date('2026-09-18T05:00:00.000Z')

interface StoredAngle {
  id: string
  userId: string
  projectId: string
  slug: string
  name: string
  desc?: string
  source: string
  parentAngleId?: string
  status: string
  sourceAssetPaths?: string[]
  promptSnapshot?: string
  createdAt: Date
  updatedAt: Date
}

function angleDoc(overrides: Partial<StoredAngle> = {}): StoredAngle {
  return {
    id: ANGLE_A,
    userId: 'user-1',
    projectId: PROJECT_ID,
    slug: 'pain-point',
    name: '痛点切入',
    source: 'user',
    status: 'candidate',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/**
 * 仓库用一个内存数组顶替，`create` / `updateById` / `listByProjectId` 之间是连着的，
 * 这样才测得动「先入库再写文件」「文件失败回滚」这种跨调用的行为。
 */
function createService(options: {
  stored?: StoredAngle[]
  angleRepository?: Record<string, unknown>
  projectsService?: Record<string, unknown>
  angleFileService?: Record<string, unknown>
} = {}) {
  const stored = options.stored ?? []
  let seq = 0

  const angleRepository = {
    listByProjectId: vi.fn(async (projectId: string, status?: string) => stored
      .filter(angle => angle.projectId === projectId && (!status || angle.status === status))
      .map(angle => ({ ...angle }))),
    getById: vi.fn(async (id: string) => {
      const found = stored.find(angle => angle.id === id)
      return found ? { ...found } : null
    }),
    getBySlug: vi.fn(async (projectId: string, slug: string) => {
      const found = stored.find(angle => angle.projectId === projectId && angle.slug === slug)
      return found ? { ...found } : null
    }),
    existsBySlug: vi.fn(async (projectId: string, slug: string) =>
      stored.some(angle => angle.projectId === projectId && angle.slug === slug)),
    countChildren: vi.fn(async (parentAngleId: string) =>
      stored.filter(angle => angle.parentAngleId === parentAngleId).length),
    create: vi.fn(async (data: Record<string, unknown>) => {
      seq += 1
      const doc = { id: `new-angle-${seq}`, createdAt: NOW, updatedAt: NOW, ...data } as StoredAngle
      stored.push(doc)
      return { ...doc }
    }),
    updateById: vi.fn(async (id: string, update: Record<string, Record<string, unknown>>) => {
      const doc = stored.find(angle => angle.id === id)
      if (!doc)
        return null

      Object.assign(doc, update.$set ?? {})
      for (const key of Object.keys(update.$unset ?? {}))
        delete (doc as unknown as Record<string, unknown>)[key]

      return { ...doc }
    }),
    deleteById: vi.fn(async (id: string) => {
      const index = stored.findIndex(angle => angle.id === id)
      if (index < 0)
        return null

      const [removed] = stored.splice(index, 1)
      return removed ?? null
    }),
    ...options.angleRepository,
  }

  const projectsService = {
    getWritableProject: vi.fn(async () => ({ id: PROJECT_ID, name: 'fortyweeks', dirName: 'fortyweeks' })),
    ...options.projectsService,
  }

  const angleFileService = {
    write: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    read: vi.fn(async () => ({ path: '', meta: {}, body: '' })),
    readBody: vi.fn(async () => '父方向的写作指引'),
    listSlugs: vi.fn(async () => []),
    ...options.angleFileService,
  }

  const service = new AnglesService(angleRepository as never, projectsService as never, angleFileService as never)

  return { service, stored, angleRepository, projectsService, angleFileService }
}

describe('angles service · 手建方向', () => {
  it('先入库再写文件，文件落在 angles/<slug>.md', async () => {
    const { service, angleRepository, angleFileService } = createService()

    const angle = await service.create(PROJECT_ID, 'user-1', {
      slug: 'pain-point',
      name: '痛点切入',
      desc: '切孕期焦虑',
    } as never)

    expect(angleRepository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      userType: UserType.User,
      projectId: PROJECT_ID,
      slug: 'pain-point',
      name: '痛点切入',
      desc: '切孕期焦虑',
      source: 'user',
      status: 'candidate',
    })
    expect(angleFileService.write).toHaveBeenCalledWith(
      'fortyweeks',
      expect.objectContaining({ slug: 'pain-point', name: '痛点切入', source: 'user', parentSlug: null }),
      '',
    )
    expect(angle).toMatchObject({ slug: 'pain-point', source: 'user' })
  })

  it('slug 不合法：不碰库也不碰文件', async () => {
    const { service, angleRepository, angleFileService } = createService()

    await expect(service.create(PROJECT_ID, 'user-1', { slug: 'Pain_Point', name: '痛点' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleSlugInvalid })

    expect(angleRepository.create).not.toHaveBeenCalled()
    expect(angleFileService.write).not.toHaveBeenCalled()
  })

  it('slug 命中保留字：按保留字报错', async () => {
    const { service } = createService()

    await expect(service.create(PROJECT_ID, 'user-1', { slug: 'config', name: '配置' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleSlugReserved })
  })

  it('同项目里 slug 撞了：拒绝', async () => {
    const { service, angleRepository } = createService({ stored: [angleDoc()] })

    await expect(service.create(PROJECT_ID, 'user-1', { slug: 'pain-point', name: '又一个' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleSlugTaken })

    expect(angleRepository.create).not.toHaveBeenCalled()
  })

  it('并发撞唯一索引：照样按 slug 被占用报', async () => {
    const { service } = createService({
      angleRepository: {
        create: vi.fn(async () => {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
        }),
      },
    })

    await expect(service.create(PROJECT_ID, 'user-1', { slug: 'pain-point', name: '痛点' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleSlugTaken })
  })

  it('文件写不出去：把刚入库的记录删掉，不留「库里有方向磁盘上没指引」', async () => {
    const { service, stored, angleRepository } = createService({
      angleFileService: {
        write: vi.fn(async () => {
          throw new AppException(ResponseCode.AngleFileWriteFailed)
        }),
      },
    })

    await expect(service.create(PROJECT_ID, 'user-1', { slug: 'pain-point', name: '痛点' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileWriteFailed })

    expect(angleRepository.deleteById).toHaveBeenCalledWith('new-angle-1')
    expect(stored).toHaveLength(0)
  })
})

describe('angles service · 派生（血统）', () => {
  it('自动填 parentAngleId 和 source=derived', async () => {
    const { service, angleRepository } = createService({ stored: [angleDoc()] })

    await service.derive(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'pain-point-deep', name: '痛点深挖' } as never)

    expect(angleRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'pain-point-deep',
      source: 'derived',
      parentAngleId: ANGLE_A,
      status: 'candidate',
    }))
  })

  it('不传正文就继承父方向的写作指引当起点', async () => {
    const { service, angleFileService } = createService({ stored: [angleDoc()] })

    await service.derive(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'pain-point-deep', name: '痛点深挖' } as never)

    expect(angleFileService.readBody).toHaveBeenCalledWith('fortyweeks', 'pain-point')
    expect(angleFileService.write).toHaveBeenCalledWith(
      'fortyweeks',
      expect.objectContaining({ parentSlug: 'pain-point' }),
      '父方向的写作指引',
    )
  })

  it('已淘汰的方向不给再往下深入', async () => {
    const { service } = createService({ stored: [angleDoc({ status: 'retired' })] })

    await expect(service.derive(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'deep', name: '深挖' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleRetired })
  })

  it('别人的方向一律报不存在', async () => {
    const { service } = createService({ stored: [angleDoc({ userId: 'user-2' })] })

    await expect(service.derive(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'deep', name: '深挖' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleNotFound })
  })

  it('方向不属于这个项目：报归属不符', async () => {
    const { service } = createService({ stored: [angleDoc({ projectId: '68c4b3f0a1b2c3d4e5f60999' })] })

    await expect(service.derive(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'deep', name: '深挖' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleProjectMismatch })
  })

  it('一条线挖太深：拦住', async () => {
    // 6 层是上限，第 7 层不给建
    const chain = Array.from({ length: 6 }, (_, index) => angleDoc({
      id: `68c4b3f0a1b2c3d4e5f6100${index}`,
      slug: `level-${index}`,
      parentAngleId: index === 0 ? undefined : `68c4b3f0a1b2c3d4e5f6100${index - 1}`,
    }))

    const { service } = createService({ stored: chain })

    await expect(service.derive(PROJECT_ID, '68c4b3f0a1b2c3d4e5f61005', 'user-1', { slug: 'level-6', name: '再深一层' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleDepthExceeded })
  })
})

describe('angles service · 更新与改名', () => {
  it('改 slug：库里改完同步改文件名', async () => {
    const { service, angleRepository, angleFileService } = createService({ stored: [angleDoc()] })

    const updated = await service.update(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'pain-point-deep' } as never)

    expect(angleRepository.updateById).toHaveBeenNthCalledWith(1, ANGLE_A, { $set: { slug: 'pain-point-deep' } })
    expect(angleFileService.rename).toHaveBeenCalledWith('fortyweeks', 'pain-point', 'pain-point-deep')
    expect(updated.slug).toBe('pain-point-deep')
  })

  it('文件改名失败：数据库整单退回原样', async () => {
    const { service, stored, angleRepository, angleFileService } = createService({
      stored: [angleDoc({ name: '痛点切入', status: 'candidate' })],
      angleFileService: {
        rename: vi.fn(async () => {
          throw new AppException(ResponseCode.AngleFileRenameFailed)
        }),
      },
    })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', {
      slug: 'pain-point-deep',
      name: '改了的名字',
      status: 'testing',
    } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileRenameFailed })

    expect(angleRepository.updateById).toHaveBeenNthCalledWith(2, ANGLE_A, {
      $set: { slug: 'pain-point', name: '痛点切入', status: 'candidate' },
    })
    expect(stored[0]).toMatchObject({ slug: 'pain-point', name: '痛点切入', status: 'candidate' })
    // 回滚之后不能再去写文件，否则又把 frontmatter 写成新名字
    expect(angleFileService.write).not.toHaveBeenCalled()
  })

  it('新 slug 已被占用：连库都不改', async () => {
    const { service, angleRepository } = createService({
      stored: [angleDoc(), angleDoc({ id: ANGLE_B, slug: 'taken' })],
    })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { slug: 'taken' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleSlugTaken })

    expect(angleRepository.updateById).not.toHaveBeenCalled()
  })

  it('只改说明：不动文件名，但把 frontmatter 刷一遍', async () => {
    const { service, angleFileService } = createService({ stored: [angleDoc()] })

    await service.update(PROJECT_ID, ANGLE_A, 'user-1', { desc: '新的说明' } as never)

    expect(angleFileService.rename).not.toHaveBeenCalled()
    expect(angleFileService.write).toHaveBeenCalledWith(
      'fortyweeks',
      expect.objectContaining({ desc: '新的说明' }),
      '父方向的写作指引',
    )
  })

  it('传了正文却写失败：必须报错，不能让人以为保存上了', async () => {
    const { service } = createService({
      stored: [angleDoc()],
      angleFileService: {
        write: vi.fn(async () => {
          throw new AppException(ResponseCode.AngleFileWriteFailed)
        }),
      },
    })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { guide: '新的写作指引' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileWriteFailed })
  })

  it('只是顺带刷 frontmatter 写失败：记日志，不把整个更新拖失败', async () => {
    const { service } = createService({
      stored: [angleDoc()],
      angleFileService: {
        write: vi.fn(async () => {
          throw new AppException(ResponseCode.AngleFileWriteFailed)
        }),
      },
    })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { status: 'testing' } as never))
      .resolves
      .toMatchObject({ status: 'testing' })
  })
})

describe('angles service · 血统防环', () => {
  it('不能把自己当父方向', async () => {
    const { service } = createService({ stored: [angleDoc()] })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { parentAngleId: ANGLE_A } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleParentSelf })
  })

  it('不能把自己的后代当父方向', async () => {
    const { service } = createService({
      stored: [
        angleDoc(),
        angleDoc({ id: ANGLE_B, slug: 'child', parentAngleId: ANGLE_A }),
        angleDoc({ id: ANGLE_C, slug: 'grandchild', parentAngleId: ANGLE_B }),
      ],
    })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { parentAngleId: ANGLE_C } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleParentCycle })
  })

  it('父方向不在同一个项目：拒绝', async () => {
    const { service } = createService({
      stored: [
        angleDoc(),
        angleDoc({ id: ANGLE_B, slug: 'other', projectId: '68c4b3f0a1b2c3d4e5f60999' }),
      ],
    })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { parentAngleId: ANGLE_B } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleParentProjectMismatch })
  })

  it('父方向不存在（或者 id 根本不像 id）：按父方向不存在报，不让它炸成 500', async () => {
    const { service } = createService({ stored: [angleDoc()] })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { parentAngleId: '不是一个 id' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleParentNotFound })

    await expect(service.update(PROJECT_ID, ANGLE_A, 'user-1', { parentAngleId: ANGLE_B } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleParentNotFound })
  })

  it('挂过去会让整条线超深：拒绝', async () => {
    const chain = Array.from({ length: 5 }, (_, index) => angleDoc({
      id: `68c4b3f0a1b2c3d4e5f6100${index}`,
      slug: `level-${index}`,
      parentAngleId: index === 0 ? undefined : `68c4b3f0a1b2c3d4e5f6100${index - 1}`,
    }))
    // 另一条两层的线，挂到 5 层那条的末端就变成 7 层
    const moving = [
      angleDoc({ id: ANGLE_B, slug: 'moving-root' }),
      angleDoc({ id: ANGLE_C, slug: 'moving-child', parentAngleId: ANGLE_B }),
    ]

    const { service } = createService({ stored: [...chain, ...moving] })

    await expect(service.update(PROJECT_ID, ANGLE_B, 'user-1', { parentAngleId: '68c4b3f0a1b2c3d4e5f61004' } as never))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleDepthExceeded })
  })

  it('传 null 把方向从血统里摘出来', async () => {
    const { service, angleRepository, stored } = createService({
      stored: [angleDoc(), angleDoc({ id: ANGLE_B, slug: 'child', parentAngleId: ANGLE_A })],
    })

    await service.update(PROJECT_ID, ANGLE_B, 'user-1', { parentAngleId: null } as never)

    expect(angleRepository.updateById).toHaveBeenNthCalledWith(1, ANGLE_B, { $unset: { parentAngleId: '' } })
    expect(stored[1]!.parentAngleId).toBeUndefined()
  })
})

describe('angles service · 删除与树', () => {
  it('删方向同时删文件', async () => {
    const { service, stored, angleRepository, angleFileService } = createService({ stored: [angleDoc()] })

    const deleted = await service.remove(PROJECT_ID, ANGLE_A, 'user-1')

    expect(angleFileService.remove).toHaveBeenCalledWith('fortyweeks', 'pain-point')
    expect(angleRepository.deleteById).toHaveBeenCalledWith(ANGLE_A)
    expect(deleted).toEqual({ id: ANGLE_A, slug: 'pain-point', filePath: 'angles/pain-point.md' })
    expect(stored).toHaveLength(0)
  })

  it('文件删不掉：数据库记录也不许删，免得留下孤儿文件', async () => {
    const { service, stored, angleRepository } = createService({
      stored: [angleDoc()],
      angleFileService: {
        remove: vi.fn(async () => {
          throw new AppException(ResponseCode.AngleFileDeleteFailed)
        }),
      },
    })

    await expect(service.remove(PROJECT_ID, ANGLE_A, 'user-1'))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleFileDeleteFailed })

    expect(angleRepository.deleteById).not.toHaveBeenCalled()
    expect(stored).toHaveLength(1)
  })

  it('名下还有子方向：不给删', async () => {
    const { service, angleFileService } = createService({
      stored: [angleDoc(), angleDoc({ id: ANGLE_B, slug: 'child', parentAngleId: ANGLE_A })],
    })

    await expect(service.remove(PROJECT_ID, ANGLE_A, 'user-1'))
      .rejects
      .toMatchObject({ code: ResponseCode.AngleHasChildren })

    expect(angleFileService.remove).not.toHaveBeenCalled()
  })

  it('树按血统组装', async () => {
    const { service } = createService({
      stored: [
        angleDoc(),
        angleDoc({ id: ANGLE_B, slug: 'child', parentAngleId: ANGLE_A }),
        angleDoc({ id: ANGLE_C, slug: 'solo' }),
      ],
    })

    const tree = await service.tree(PROJECT_ID, 'user-1')

    expect(tree.map(node => node.angle.slug)).toEqual(['pain-point', 'solo'])
    expect(tree[0]!.children.map(node => node.angle.slug)).toEqual(['child'])
  })
})

describe('angles service · 登记 AI 写出来的方向文件', () => {
  it('把还没入库的方向登记进来，来源默认 ai，血统按 frontmatter 的 parent 连', async () => {
    const files: Record<string, { meta: Record<string, unknown>, body: string }> = {
      'pain-point': {
        meta: { name: '痛点切入', source: 'ai', sourceAssetPaths: ['background/feedback/bad.md'], promptSnapshot: '提示词' },
        body: '正文',
      },
      'pain-point-deep': {
        meta: { name: '痛点深挖', parentSlug: 'pain-point' },
        body: '正文',
      },
    }

    const { service, stored, angleRepository } = createService({
      angleFileService: {
        listSlugs: vi.fn(async () => ['pain-point', 'pain-point-deep']),
        read: vi.fn(async (_dirName: string, slug: string) => ({ path: '', ...files[slug]! })),
      },
    })

    const angles = await service.syncFromFiles(PROJECT_ID, 'user-1')

    expect(angles).toHaveLength(2)
    expect(stored[0]).toMatchObject({
      slug: 'pain-point',
      name: '痛点切入',
      source: 'ai',
      status: 'candidate',
      sourceAssetPaths: ['background/feedback/bad.md'],
      promptSnapshot: '提示词',
    })
    expect(stored[1]).toMatchObject({ slug: 'pain-point-deep', parentAngleId: stored[0]!.id })
    expect(angleRepository.create).toHaveBeenCalledTimes(2)
  })

  it('已经登记过的方向一个字段都不动', async () => {
    const { service, angleRepository } = createService({
      stored: [angleDoc({ name: '人改过的名字' })],
      angleFileService: {
        listSlugs: vi.fn(async () => ['pain-point']),
        read: vi.fn(async () => ({ path: '', meta: { name: 'AI 写的名字' }, body: '' })),
      },
    })

    await service.syncFromFiles(PROJECT_ID, 'user-1')

    expect(angleRepository.create).not.toHaveBeenCalled()
    expect(angleRepository.updateById).not.toHaveBeenCalled()
  })

  it('某个文件读不了：跳过它，别的照常登记', async () => {
    const { service, stored } = createService({
      angleFileService: {
        listSlugs: vi.fn(async () => ['broken', 'fine']),
        read: vi.fn(async (_dirName: string, slug: string) => {
          if (slug === 'broken')
            throw new AppException(ResponseCode.AngleFileInvalid)

          return { path: '', meta: { name: '好的' }, body: '' }
        }),
      },
    })

    await service.syncFromFiles(PROJECT_ID, 'user-1')

    expect(stored.map(angle => angle.slug)).toEqual(['fine'])
  })
})
