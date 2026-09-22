/**
 * 方向接口的路由与入参（真的起一个 HTTP 服务打一遍）。
 *
 * 光靠直接调 controller 方法测不出两件事：
 * 1. `POST /confirm`（批量）会不会被 `/:angleId/...` 那些动态段吃掉；
 * 2. query 里的 `confirmed=false` 到底解析成布尔 false 还是字符串 'false'
 *    —— 后者会让「只看待确认」当场变成「只看已确认」，而且一路静默。
 */
import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { APP_PIPE } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ZodValidationPipe } from '@yikart/common'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnglesController } from './angles.controller'
import { AnglesService } from './angles.service'

vi.mock('../../config', () => ({ config: { projects: { root: '/data/projects' } } }))
vi.mock('@yikart/mongodb', () => ({
  Angle: class Angle {},
  AngleRepository: class AngleRepository {},
  AngleSource: { AI: 'ai', USER: 'user', DERIVED: 'derived' },
  AngleStatus: { CANDIDATE: 'candidate', TESTING: 'testing', EFFECTIVE: 'effective', RETIRED: 'retired' },
  ProjectRepository: class ProjectRepository {},
  ProjectStatus: { ACTIVE: 'active', ARCHIVED: 'archived' },
}))

const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'
const ANGLE_ID = '68c4b3f0a1b2c3d4e5f60001'
const NOW = new Date('2026-09-22T05:00:00.000Z')

function doc(overrides: Record<string, unknown> = {}) {
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

const service = {
  list: vi.fn(async () => [doc({ confirmedAt: NOW })]),
  tree: vi.fn(async () => []),
  create: vi.fn(),
  update: vi.fn(),
  derive: vi.fn(),
  remove: vi.fn(),
  syncFromFiles: vi.fn(),
  confirm: vi.fn(async () => doc({ confirmedAt: NOW })),
  confirmMany: vi.fn(async () => [doc({ confirmedAt: NOW })]),
}

let app: INestApplication
let base: string

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AnglesController],
    providers: [
      { provide: AnglesService, useValue: service },
      { provide: APP_PIPE, useClass: ZodValidationPipe },
    ],
  }).compile()

  app = moduleRef.createNestApplication()
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1' }
    next()
  })
  await app.init()
  await app.listen(0)
  const address = (app.getHttpServer() as Server).address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await app.close()
})

describe('方向接口真的跑起来之后的路由与入参', () => {
  it('列表的 confirmed=false 解析成布尔 false', async () => {
    service.list.mockClear()
    const res = await fetch(`${base}/projects/${PROJECT_ID}/angles/list?confirmed=false`)
    expect(res.status).toBe(200)
    expect(service.list).toHaveBeenCalledWith(PROJECT_ID, 'user-1', undefined, false)
  })

  it('列表的 confirmed=true 解析成布尔 true，和 status 一起传也不串', async () => {
    service.list.mockClear()
    await fetch(`${base}/projects/${PROJECT_ID}/angles/list?confirmed=true&status=candidate`)
    expect(service.list).toHaveBeenCalledWith(PROJECT_ID, 'user-1', 'candidate', true)
  })

  it('列表不传 confirmed 时是 undefined，也就是全部', async () => {
    service.list.mockClear()
    await fetch(`${base}/projects/${PROJECT_ID}/angles/list`)
    expect(service.list).toHaveBeenCalledWith(PROJECT_ID, 'user-1', undefined, undefined)
  })

  it('批量采用走 /confirm，不会被 /:angleId 之类的动态段吃掉', async () => {
    service.confirm.mockClear()
    service.confirmMany.mockClear()
    const res = await fetch(`${base}/projects/${PROJECT_ID}/angles/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ angleIds: [ANGLE_ID] }),
    })
    expect(res.status).toBe(201)
    expect(service.confirmMany).toHaveBeenCalledWith(PROJECT_ID, 'user-1', [ANGLE_ID])
    expect(service.confirm).not.toHaveBeenCalled()
  })

  it('单条采用走 /:angleId/confirm', async () => {
    service.confirm.mockClear()
    service.confirmMany.mockClear()
    const res = await fetch(`${base}/projects/${PROJECT_ID}/angles/${ANGLE_ID}/confirm`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(service.confirm).toHaveBeenCalledWith(PROJECT_ID, ANGLE_ID, 'user-1')
    expect(service.confirmMany).not.toHaveBeenCalled()
  })

  it('响应体带出 confirmedAt，待确认的不带', async () => {
    service.list.mockClear()
    service.list.mockResolvedValueOnce([doc({ confirmedAt: NOW }), doc({ id: '68c4b3f0a1b2c3d4e5f60002', slug: 'pending-one' })])
    const res = await fetch(`${base}/projects/${PROJECT_ID}/angles/list`)
    const raw = await res.json() as { data?: unknown } | unknown[]
    const list = (Array.isArray(raw) ? raw : raw.data) as { slug: string, confirmedAt?: string }[]
    expect(list[0]!.confirmedAt).toBe(NOW.toISOString())
    expect(list[1]!.slug).toBe('pending-one')
    expect('confirmedAt' in list[1]!).toBe(false)
  })
})
