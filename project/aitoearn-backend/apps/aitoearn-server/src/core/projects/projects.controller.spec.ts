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
