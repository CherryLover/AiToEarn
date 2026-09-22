import type { TokenInfo } from '@yikart/aitoearn-auth'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnglesController } from './angles.controller'
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

const TOKEN = { id: 'user-1' } as TokenInfo
const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'
const ANGLE_ID = '68c4b3f0a1b2c3d4e5f60001'
const NOW = new Date('2026-09-18T05:00:00.000Z')

function angleDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: ANGLE_ID,
    projectId: PROJECT_ID,
    slug: 'pain-point',
    name: '痛点切入',
    source: 'ai',
    status: 'candidate',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('方向接口的路由装配', () => {
  let controller: AnglesController
  let anglesService: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    anglesService = {
      list: vi.fn(),
      tree: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      derive: vi.fn(),
      remove: vi.fn(),
      syncFromFiles: vi.fn(),
      confirm: vi.fn(),
      confirmMany: vi.fn(),
    }

    // compile() 会把 controller 和它身上的装饰器真的装配一遍，写错在这里就炸
    const moduleRef = await Test.createTestingModule({
      controllers: [AnglesController],
      providers: [{ provide: AnglesService, useValue: anglesService }],
    }).compile()

    controller = moduleRef.get(AnglesController)
  })

  it('列表把 service 的结果转成 VO，并补上指引文件路径', async () => {
    anglesService.list!.mockResolvedValue([angleDoc({ desc: '切焦虑', sourceAssetPaths: ['background/a.md'] })])

    const result = await controller.list(TOKEN, PROJECT_ID, { status: undefined, confirmed: undefined } as never)

    expect(anglesService.list).toHaveBeenCalledWith(PROJECT_ID, 'user-1', undefined, undefined)
    expect(result[0]).toMatchObject({
      id: ANGLE_ID,
      slug: 'pain-point',
      desc: '切焦虑',
      parentAngleId: null,
      promptSnapshot: null,
      sourceAssetPaths: ['background/a.md'],
      filePath: 'angles/pain-point.md',
    })
  })

  it('树接口按血统嵌套返回', async () => {
    anglesService.tree!.mockResolvedValue([
      {
        angle: angleDoc(),
        children: [{ angle: angleDoc({ id: '68c4b3f0a1b2c3d4e5f60002', slug: 'child', parentAngleId: ANGLE_ID }), children: [] }],
      },
    ])

    const result = await controller.tree(TOKEN, PROJECT_ID)

    expect(result).toHaveLength(1)
    expect(result[0]!.children[0]).toMatchObject({ slug: 'child', parentAngleId: ANGLE_ID })
  })

  it('派生接口把路径上的方向当父方向传下去', async () => {
    anglesService.derive!.mockResolvedValue(angleDoc({ slug: 'deep', source: 'derived' }))

    const dto = { slug: 'deep', name: '深挖' }
    await controller.derive(TOKEN, PROJECT_ID, ANGLE_ID, dto as never)

    expect(anglesService.derive).toHaveBeenCalledWith(PROJECT_ID, ANGLE_ID, 'user-1', dto)
  })

  it('删除接口返回被删的方向和一并删掉的文件', async () => {
    anglesService.remove!.mockResolvedValue({ id: ANGLE_ID, slug: 'pain-point', filePath: 'angles/pain-point.md' })

    await expect(controller.remove(TOKEN, PROJECT_ID, ANGLE_ID)).resolves.toEqual({
      id: ANGLE_ID,
      slug: 'pain-point',
      filePath: 'angles/pain-point.md',
    })
  })

  it('列表把「只看待确认」原样透传下去', async () => {
    anglesService.list!.mockResolvedValue([])

    await controller.list(TOKEN, PROJECT_ID, { status: undefined, confirmed: false } as never)

    expect(anglesService.list).toHaveBeenCalledWith(PROJECT_ID, 'user-1', undefined, false)
  })

  it('采用单条：路径上的方向传下去，返回带确认时间的 VO', async () => {
    const confirmedAt = new Date('2026-09-22T03:00:00.000Z')
    anglesService.confirm!.mockResolvedValue(angleDoc({ confirmedAt }))

    const result = await controller.confirm(TOKEN, PROJECT_ID, ANGLE_ID)

    expect(anglesService.confirm).toHaveBeenCalledWith(PROJECT_ID, ANGLE_ID, 'user-1')
    expect(result.confirmedAt).toEqual(confirmedAt)
  })

  it('待确认的方向转成 VO 时不带确认时间', async () => {
    anglesService.list!.mockResolvedValue([angleDoc()])

    const result = await controller.list(TOKEN, PROJECT_ID, { status: undefined, confirmed: false } as never)

    expect(result[0]!.confirmedAt).toBeUndefined()
  })

  it('批量采用把 body 里的 id 列表传下去', async () => {
    anglesService.confirmMany!.mockResolvedValue([angleDoc({ confirmedAt: NOW })])

    const result = await controller.confirmMany(TOKEN, PROJECT_ID, { angleIds: [ANGLE_ID] } as never)

    expect(anglesService.confirmMany).toHaveBeenCalledWith(PROJECT_ID, 'user-1', [ANGLE_ID])
    expect(result).toHaveLength(1)
  })

  it('登记接口把文件里的方向列表转成 VO', async () => {
    anglesService.syncFromFiles!.mockResolvedValue([angleDoc()])

    const result = await controller.sync(TOKEN, PROJECT_ID)

    expect(anglesService.syncFromFiles).toHaveBeenCalledWith(PROJECT_ID, 'user-1')
    expect(result[0]!.slug).toBe('pain-point')
  })
})
