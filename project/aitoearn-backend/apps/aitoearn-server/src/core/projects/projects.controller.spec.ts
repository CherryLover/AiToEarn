import type { TokenInfo } from '@yikart/aitoearn-auth'
import type { Response } from 'express'
import { Readable } from 'node:stream'
import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectFilesService } from './project-files.service'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'

vi.mock('../../config', () => ({
  config: { projects: { root: '/data/projects' } },
}))
vi.mock('@yikart/mongodb', () => ({
  AssetType: { UserMedia: 'userMedia' },
  ProjectStatus: { ACTIVE: 'active', ARCHIVED: 'archived' },
  ProjectRepository: class ProjectRepository {},
}))
vi.mock('@yikart/assets', () => ({
  AssetsService: class AssetsService {},
}))

const TOKEN = { id: 'user-1' } as TokenInfo
const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'
const NOW = new Date('2026-09-18T05:00:00.000Z')

describe('项目接口的路由装配', () => {
  let controller: ProjectsController
  let filesService: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(async () => {
    filesService = {
      tree: vi.fn(),
      read: vi.fn(),
      write: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      upload: vi.fn(),
      download: vi.fn(),
    }

    // compile() 真的会把 controller 和它身上的装饰器（含 FileInterceptor）装配一遍，
    // 装饰器写错或依赖缺失在这里就会炸，不用等应用启动
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: {} },
        { provide: ProjectFilesService, useValue: filesService },
      ],
    }).compile()

    controller = moduleRef.get(ProjectsController)
  })

  it('目录树接口把 service 的结果转成 VO', async () => {
    filesService.tree!.mockResolvedValue({
      name: 'fortyweeks',
      path: '',
      type: 'dir',
      size: null,
      updatedAt: NOW,
      children: [{ name: 'media', path: 'media', type: 'dir', size: null, updatedAt: NOW, children: null }],
    })

    const vo = await controller.fileTree(TOKEN, PROJECT_ID, { path: '', depth: 3 })

    expect(filesService.tree).toHaveBeenCalledWith(PROJECT_ID, 'user-1', '', 3)
    expect(vo.children![0]!.path).toBe('media')
  })

  it('读写接口转 VO 时字段不丢', async () => {
    filesService.read!.mockResolvedValue({ path: 'CLAUDE.md', content: '# 四十周', size: 9, updatedAt: NOW })
    const read = await controller.fileRead(TOKEN, PROJECT_ID, { path: 'CLAUDE.md' })
    expect(read).toMatchObject({ path: 'CLAUDE.md', content: '# 四十周', size: 9 })

    filesService.write!.mockResolvedValue({ path: 'drafts/a.md', content: 'x', size: 1, updatedAt: NOW })
    const written = await controller.fileWrite(TOKEN, PROJECT_ID, { path: 'drafts/a.md', content: 'x' })
    expect(written.path).toBe('drafts/a.md')
  })

  it('删除接口返回被删掉的路径', async () => {
    filesService.remove!.mockResolvedValue({ path: 'drafts/a.md' })

    const vo = await controller.fileDelete(TOKEN, PROJECT_ID, { path: 'drafts/a.md' })
    expect(vo.path).toBe('drafts/a.md')
  })

  it('上传没带文件时直接报上传失败', async () => {
    await expect(controller.fileUpload(TOKEN, PROJECT_ID, {}, undefined))
      .rejects
      .toMatchObject({ code: 20107 })
  })

  it('上传把 multer 的字段原样传给 service', async () => {
    filesService.upload!.mockResolvedValue({
      name: 'a.png',
      path: 'media/a.png',
      type: 'file',
      size: 3,
      updatedAt: NOW,
      children: null,
    })

    const vo = await controller.fileUpload(TOKEN, PROJECT_ID, { path: 'media' }, {
      originalname: 'a.png',
      mimetype: 'image/png',
      size: 3,
      buffer: Buffer.from('abc'),
    })

    expect(filesService.upload).toHaveBeenCalledWith(PROJECT_ID, 'user-1', 'media', expect.objectContaining({
      originalname: 'a.png',
      mimetype: 'image/png',
    }))
    expect(vo.path).toBe('media/a.png')
  })

  it('上传把 busboy 解坏的中文名字修回 UTF-8 再交给 service', async () => {
    filesService.upload!.mockResolvedValue({
      name: '首页截图.png',
      path: 'media/首页截图.png',
      type: 'file',
      size: 3,
      updatedAt: NOW,
      children: null,
    })

    await controller.fileUpload(TOKEN, PROJECT_ID, { path: 'media' }, {
      // busboy 默认按 latin1 解文件名，控制器拿到的就是这串乱码
      originalname: Buffer.from('首页截图.png', 'utf8').toString('latin1'),
      mimetype: 'image/png',
      size: 3,
      buffer: Buffer.from('abc'),
    })

    expect(filesService.upload).toHaveBeenCalledWith(PROJECT_ID, 'user-1', 'media', expect.objectContaining({
      originalname: '首页截图.png',
    }))
  })

  it('下载接口设好响应头，中文文件名两种写法都给', async () => {
    filesService.download!.mockResolvedValue({
      stream: Readable.from([Buffer.from('x')]),
      size: 1,
      fileName: '用户反馈.png',
      contentType: 'image/png',
    })

    const headers: Record<string, unknown> = {}
    const res = {
      setHeader: (key: string, value: unknown) => {
        headers[key] = value
      },
    } as unknown as Response

    const file = await controller.fileDownload(TOKEN, PROJECT_ID, { path: 'media/用户反馈.png' }, res)

    expect(headers['Content-Type']).toBe('image/png')
    expect(headers['Content-Length']).toBe(1)
    expect(String(headers['Content-Disposition'])).toContain('filename*=UTF-8\'\'')
    // 非 ASCII 的兜底文件名不能把原字节直接塞进头里
    expect(String(headers['Content-Disposition'])).toContain('filename="____.png"')
    expect(file).toBeDefined()
  })
})

describe('项目本身的路由装配', () => {
  let controller: ProjectsController
  let service: Record<string, ReturnType<typeof vi.fn>>
  let filesService: Record<string, ReturnType<typeof vi.fn>>

  function project(overrides: Record<string, unknown> = {}) {
    return {
      id: PROJECT_ID,
      name: 'forty-weeks',
      displayName: '四十周',
      desc: '孕期内容',
      audience: null,
      goal: null,
      status: 'active',
      dirName: 'forty-weeks',
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    }
  }

  beforeEach(async () => {
    service = {
      create: vi.fn(),
      listByUserId: vi.fn(),
      suggestName: vi.fn(),
      getDetail: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
    }
    filesService = { mkdir: vi.fn(), rename: vi.fn() }

    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: service },
        { provide: ProjectFilesService, useValue: filesService },
      ],
    }).compile()

    controller = moduleRef.get(ProjectsController)
  })

  it('建项目把表单透传下去，返回详情 VO', async () => {
    service.create!.mockResolvedValue(project())
    const dto = { name: 'forty-weeks', displayName: '四十周', desc: '孕期内容' }

    const vo = await controller.create(TOKEN, dto as never)

    expect(service.create).toHaveBeenCalledWith('user-1', dto)
    expect(vo.name).toBe('forty-weeks')
    expect(vo.dirName).toBe('forty-weeks')
  })

  /** 列表项只给列表要的那几个字段，目录名、归档时间这些是详情才有的 */
  it('列表按状态筛，并且只给列表字段', async () => {
    service.listByUserId!.mockResolvedValue([project()])

    const vos = await controller.list(TOKEN, { status: 'active' } as never)

    expect(service.listByUserId).toHaveBeenCalledWith('user-1', 'active')
    expect(vos[0]!.displayName).toBe('四十周')
    expect(vos[0]).not.toHaveProperty('dirName')
  })

  it('说明没填过时列表里给的是 null，不是缺字段', async () => {
    service.listByUserId!.mockResolvedValue([project({ desc: undefined })])

    const vos = await controller.list(TOKEN, {} as never)

    expect(vos[0]!.desc).toBeNull()
  })

  it('建议英文名包一层 VO 再给出去', async () => {
    service.suggestName!.mockResolvedValue('quiet-otter')

    const vo = await controller.suggestName(TOKEN)

    expect(vo.name).toBe('quiet-otter')
  })

  it('详情把没填过的字段都补成 null', async () => {
    service.getDetail!.mockResolvedValue(project({ desc: undefined, audience: undefined, goal: undefined }))

    const vo = await controller.detail(TOKEN, PROJECT_ID)

    expect(service.getDetail).toHaveBeenCalledWith(PROJECT_ID, 'user-1')
    expect(vo.desc).toBeNull()
    expect(vo.audience).toBeNull()
    expect(vo.goal).toBeNull()
  })

  it('更新把表单透传下去，返回改完的详情', async () => {
    service.update!.mockResolvedValue(project({ displayName: '四十周 2.0' }))
    const dto = { displayName: '四十周 2.0' }

    const vo = await controller.update(TOKEN, PROJECT_ID, dto as never)

    expect(service.update).toHaveBeenCalledWith(PROJECT_ID, 'user-1', dto)
    expect(vo.displayName).toBe('四十周 2.0')
  })

  /** 归档只改目录名，英文名不动，两个值从这一刻起就不一样了 */
  it('归档之后目录名带上归档前缀，归档时间也回传', async () => {
    service.archive!.mockResolvedValue(project({
      status: 'archived',
      dirName: '_archived_forty-weeks_20260921030000',
      archivedAt: NOW,
    }))

    const vo = await controller.archive(TOKEN, PROJECT_ID)

    expect(service.archive).toHaveBeenCalledWith(PROJECT_ID, 'user-1')
    expect(vo.name).toBe('forty-weeks')
    expect(vo.dirName).toBe('_archived_forty-weeks_20260921030000')
    expect(vo.archivedAt).toEqual(NOW)
  })

  it('新建文件夹把路径透传给文件服务', async () => {
    filesService.mkdir!.mockResolvedValue({
      name: 'assets',
      path: 'media/assets',
      type: 'dir',
      size: null,
      updatedAt: NOW,
      children: null,
    })

    const vo = await controller.fileMkdir(TOKEN, PROJECT_ID, { path: 'media/assets' } as never)

    expect(filesService.mkdir).toHaveBeenCalledWith(PROJECT_ID, 'user-1', 'media/assets')
    expect(vo.path).toBe('media/assets')
  })

  it('改名把起点和终点一起交给文件服务', async () => {
    filesService.rename!.mockResolvedValue({
      name: 'assets',
      path: 'assets',
      type: 'dir',
      size: null,
      updatedAt: NOW,
      children: null,
    })

    const vo = await controller.fileRename(TOKEN, PROJECT_ID, { from: 'media', to: 'assets' } as never)

    expect(filesService.rename).toHaveBeenCalledWith(PROJECT_ID, 'user-1', 'media', 'assets')
    expect(vo.path).toBe('assets')
  })
})
