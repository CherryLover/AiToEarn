import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectDirService } from './project-dir.service'
import { ProjectFilesService } from './project-files.service'

const mocks = vi.hoisted(() => ({
  config: { projects: { root: '' } },
}))

vi.mock('../../config', () => ({ config: mocks.config }))

// 只为了拿 AssetType 一个枚举和一个注入令牌，不值得把整套 mongoose schema / OSS 客户端拖进来
vi.mock('@yikart/mongodb', () => ({
  AssetType: { UserMedia: 'userMedia' },
  ProjectStatus: { ACTIVE: 'active', ARCHIVED: 'archived' },
  ProjectRepository: class ProjectRepository {},
}))
vi.mock('@yikart/assets', () => ({
  AssetsService: class AssetsService {},
}))

/** 1x1 的透明 PNG，够 image-size 读出宽高 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const USER_ID = 'user-1'
const PROJECT_ID = '68c4b3f0a1b2c3d4e5f60718'

describe('项目物料文件接口', () => {
  let root = ''
  let outside = ''
  let projectDir = ''
  let service: ProjectFilesService
  let getWritableProject: ReturnType<typeof vi.fn>
  let uploadFromBuffer: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'aitoearn-files-'))
    outside = await mkdtemp(path.join(tmpdir(), 'aitoearn-outside-'))
    mocks.config.projects.root = root

    const dirService = new ProjectDirService()
    await dirService.createProjectDir({ name: 'fortyweeks', displayName: '四十周' })
    projectDir = path.join(root, 'fortyweeks')

    getWritableProject = vi.fn().mockResolvedValue({ id: PROJECT_ID, dirName: 'fortyweeks' })
    uploadFromBuffer = vi.fn().mockResolvedValue({ url: 'https://oss.example.com/k/abc.png' })

    service = new ProjectFilesService(
      { getWritableProject } as never,
      dirService,
      { uploadFromBuffer } as never,
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  describe('归属与归档', () => {
    it('项目不可写时所有接口都进不去', async () => {
      getWritableProject.mockRejectedValue({ code: ResponseCode.ProjectArchived })

      await expect(service.tree(PROJECT_ID, USER_ID)).rejects.toMatchObject({ code: ResponseCode.ProjectArchived })
      await expect(service.read(PROJECT_ID, USER_ID, 'CLAUDE.md')).rejects.toMatchObject({ code: ResponseCode.ProjectArchived })
      await expect(service.write(PROJECT_ID, USER_ID, 'a.md', 'x')).rejects.toMatchObject({ code: ResponseCode.ProjectArchived })
    })
  })

  describe('目录树', () => {
    it('默认展开三层，项目根返回空 path', async () => {
      const tree = await service.tree(PROJECT_ID, USER_ID)

      expect(tree.path).toBe('')
      expect(tree.type).toBe('dir')
      expect(tree.size).toBeNull()

      const names = tree.children!.map(node => node.name)
      expect(names).toContain('background')
      expect(names).toContain('media')
      expect(names).toContain('CLAUDE.md')

      const background = tree.children!.find(node => node.name === 'background')!
      expect(background.children!.map(n => n.name)).toEqual(['feedback', 'legal', 'product', 'website'])
      // 第三层展开到 product 里的 .gitkeep
      expect(background.children!.find(n => n.name === 'product')!.children!.map(n => n.name)).toEqual(['.gitkeep'])
    })

    it('depth=1 时只列一层，children 为 null', async () => {
      const tree = await service.tree(PROJECT_ID, USER_ID, '', 1)
      const background = tree.children!.find(node => node.name === 'background')!

      expect(background.children).toBeNull()
    })

    it('可以只看子目录', async () => {
      const tree = await service.tree(PROJECT_ID, USER_ID, 'background/product')

      expect(tree.path).toBe('background/product')
      expect(tree.children!.map(n => n.path)).toEqual(['background/product/.gitkeep'])
    })

    it('软链不出现在树里', async () => {
      await symlink(outside, path.join(projectDir, 'bridge'), 'junction')

      const tree = await service.tree(PROJECT_ID, USER_ID, '', 1)
      expect(tree.children!.map(n => n.name)).not.toContain('bridge')
    })

    it('路径指到文件上会被拒绝', async () => {
      await expect(service.tree(PROJECT_ID, USER_ID, 'CLAUDE.md'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFilePathInvalid })
    })
  })

  describe('读文本', () => {
    it('读得到 CLAUDE.md', async () => {
      const file = await service.read(PROJECT_ID, USER_ID, 'CLAUDE.md')

      expect(file.path).toBe('CLAUDE.md')
      expect(file.content).toContain('# 四十周')
      expect(file.size).toBeGreaterThan(0)
    })

    it('按扩展名就能判定的二进制直接拒绝', async () => {
      await writeFile(path.join(projectDir, 'media', 'a.png'), ONE_PIXEL_PNG)

      await expect(service.read(PROJECT_ID, USER_ID, 'media/a.png'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileNotText })
    })

    it('扩展名骗人的也会被内容嗅探拦下', async () => {
      await writeFile(path.join(projectDir, 'media', 'fake.md'), ONE_PIXEL_PNG)

      await expect(service.read(PROJECT_ID, USER_ID, 'media/fake.md'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileNotText })
    })

    it('超过 1 MB 的文本让走下载', async () => {
      await writeFile(path.join(projectDir, 'big.md'), Buffer.alloc(1024 * 1024 + 1, 0x61))

      await expect(service.read(PROJECT_ID, USER_ID, 'big.md'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileTooLarge })
    })

    it('没有扩展名的文件按内容判定', async () => {
      await writeFile(path.join(projectDir, 'LICENSE'), 'MIT', 'utf8')

      const file = await service.read(PROJECT_ID, USER_ID, 'LICENSE')
      expect(file.content).toBe('MIT')
    })

    it('路径越界一律拒绝', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')

      await expect(service.read(PROJECT_ID, USER_ID, '../../etc/passwd'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFilePathInvalid })
      await expect(service.read(PROJECT_ID, USER_ID, '/etc/passwd'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFilePathInvalid })
    })
  })

  describe('写文本', () => {
    it('新建和覆盖都能写', async () => {
      const created = await service.write(PROJECT_ID, USER_ID, 'background/product/intro.md', '产品介绍')
      expect(created.path).toBe('background/product/intro.md')
      expect(await readFile(path.join(projectDir, 'background/product/intro.md'), 'utf8')).toBe('产品介绍')

      await service.write(PROJECT_ID, USER_ID, 'background/product/intro.md', '改过的介绍')
      expect(await readFile(path.join(projectDir, 'background/product/intro.md'), 'utf8')).toBe('改过的介绍')
    })

    it('不让用写文本的口子塞二进制扩展名', async () => {
      await expect(service.write(PROJECT_ID, USER_ID, 'media/a.png', 'x'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileNotText })
    })

    it('超过 1 MB 拒绝', async () => {
      await expect(service.write(PROJECT_ID, USER_ID, 'big.md', 'a'.repeat(1024 * 1024 + 1)))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileTooLarge })
    })

    it('父目录不存在时报找不到，不会自作主张建目录', async () => {
      await expect(service.write(PROJECT_ID, USER_ID, 'nope/a.md', 'x'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileNotFound })
    })
  })

  describe('建目录 / 改名 / 删除', () => {
    it('建目录成功，重复建报已存在', async () => {
      const node = await service.mkdir(PROJECT_ID, USER_ID, 'angles/2026')
      expect(node.type).toBe('dir')
      expect(node.path).toBe('angles/2026')

      await expect(service.mkdir(PROJECT_ID, USER_ID, 'angles/2026'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileExists })
    })

    it('改名和移动都行，目标已存在会拒绝', async () => {
      await service.write(PROJECT_ID, USER_ID, 'drafts/a.md', 'x')
      const moved = await service.rename(PROJECT_ID, USER_ID, 'drafts/a.md', 'drafts/b.md')
      expect(moved.path).toBe('drafts/b.md')

      await service.write(PROJECT_ID, USER_ID, 'drafts/c.md', 'y')
      await expect(service.rename(PROJECT_ID, USER_ID, 'drafts/c.md', 'drafts/b.md'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileExists })
    })

    it('删文件和删目录都行', async () => {
      await service.write(PROJECT_ID, USER_ID, 'drafts/a.md', 'x')
      await service.remove(PROJECT_ID, USER_ID, 'drafts/a.md')
      expect(await readdir(path.join(projectDir, 'drafts'))).toEqual(['.gitkeep'])

      await service.remove(PROJECT_ID, USER_ID, 'drafts')
      expect(await readdir(projectDir)).not.toContain('drafts')
    })

    it('删软链只摘链接，不跟进去删外面的东西', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      await symlink(outside, path.join(projectDir, 'media', 'bridge'), 'junction')

      await service.remove(PROJECT_ID, USER_ID, 'media/bridge')

      expect(await readdir(path.join(projectDir, 'media'))).toEqual(['.gitkeep'])
      expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('机密')
    })
  })

  describe('上传', () => {
    it('普通文件只落盘，不写名片也不传 OSS', async () => {
      const node = await service.upload(PROJECT_ID, USER_ID, 'background/feedback', {
        originalname: 'feedback.md',
        mimetype: 'text/markdown',
        size: 6,
        buffer: Buffer.from('差评：太慢', 'utf8'),
      })

      expect(node.path).toBe('background/feedback/feedback.md')
      expect(await readdir(path.join(projectDir, 'background/feedback'))).toEqual(['.gitkeep', 'feedback.md'])
      expect(uploadFromBuffer).not.toHaveBeenCalled()
    })

    it('图片：原件落盘 + 传 OSS + 写名片，正文留空', async () => {
      await service.upload(PROJECT_ID, USER_ID, 'media', {
        originalname: 'screenshot-home.png',
        mimetype: 'image/png',
        size: ONE_PIXEL_PNG.length,
        buffer: ONE_PIXEL_PNG,
      })

      const files = await readdir(path.join(projectDir, 'media'))
      expect(files).toContain('screenshot-home.png')
      expect(files).toContain('screenshot-home.png.md')

      expect(uploadFromBuffer).toHaveBeenCalledWith(USER_ID, ONE_PIXEL_PNG, expect.objectContaining({
        mimeType: 'image/png',
        filename: 'screenshot-home.png',
      }))

      const card = await readFile(path.join(projectDir, 'media', 'screenshot-home.png.md'), 'utf8')
      expect(card).toContain('file: screenshot-home.png')
      expect(card).toContain('type: image')
      expect(card).toContain('oss: https://oss.example.com/k/abc.png')
      expect(card).toContain(`size: ${ONE_PIXEL_PNG.length}`)
      expect(card).toContain('width: 1')
      expect(card).toContain('height: 1')
      expect(card).toMatch(/uploadedAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/)
      // 正文固定是占位，不许代码编出一段图片描述
      expect(card.split('---')[2]!.trim()).toBe('（这张图是什么，上传时留空。以后由能读图的模型补上，或由你手写。）')
    })

    it('oSS 挂了也不阻塞：原件照样在，名片里 oss 留空', async () => {
      uploadFromBuffer.mockRejectedValue(new Error('oss down'))

      await service.upload(PROJECT_ID, USER_ID, 'media', {
        originalname: 'a.png',
        mimetype: 'image/png',
        size: ONE_PIXEL_PNG.length,
        buffer: ONE_PIXEL_PNG,
      })

      expect(await readdir(path.join(projectDir, 'media'))).toContain('a.png')
      const card = await readFile(path.join(projectDir, 'media', 'a.png.md'), 'utf8')
      expect(card).toContain('oss: \n')
    })

    it('读不出宽高时名片就不写宽高', async () => {
      await service.upload(PROJECT_ID, USER_ID, 'media', {
        originalname: 'broken.png',
        mimetype: 'image/png',
        size: 3,
        buffer: Buffer.from('not an image'),
      })

      const card = await readFile(path.join(projectDir, 'media', 'broken.png.md'), 'utf8')
      expect(card).not.toContain('width:')
      expect(card).not.toContain('height:')
    })

    it('同名文件不覆盖，直接报已存在', async () => {
      const file = {
        originalname: 'a.png',
        mimetype: 'image/png',
        size: ONE_PIXEL_PNG.length,
        buffer: ONE_PIXEL_PNG,
      }
      await service.upload(PROJECT_ID, USER_ID, 'media', file)

      await expect(service.upload(PROJECT_ID, USER_ID, 'media', file))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileExists })
    })

    it('文件名里的路径分隔符不作数，只取最后一段', async () => {
      await expect(service.upload(PROJECT_ID, USER_ID, 'media', {
        originalname: '../../../etc/passwd',
        mimetype: 'text/plain',
        size: 1,
        buffer: Buffer.from('x'),
      })).resolves.toMatchObject({ path: 'media/passwd' })

      expect(await readdir(path.join(projectDir, 'media'))).toContain('passwd')
    })

    it('目标目录越界会被拒绝', async () => {
      await expect(service.upload(PROJECT_ID, USER_ID, '../..', {
        originalname: 'a.md',
        mimetype: 'text/plain',
        size: 1,
        buffer: Buffer.from('x'),
      })).rejects.toMatchObject({ code: ResponseCode.ProjectFilePathInvalid })
    })
  })

  describe('下载', () => {
    it('二进制原件走下载，带上正确的类型和文件名', async () => {
      await writeFile(path.join(projectDir, 'media', 'a.png'), ONE_PIXEL_PNG)

      const payload = await service.download(PROJECT_ID, USER_ID, 'media/a.png')
      expect(payload.fileName).toBe('a.png')
      expect(payload.contentType).toBe('image/png')
      expect(payload.size).toBe(ONE_PIXEL_PNG.length)

      const chunks: Buffer[] = []
      for await (const chunk of payload.stream)
        chunks.push(chunk as Buffer)

      expect(Buffer.concat(chunks).equals(ONE_PIXEL_PNG)).toBe(true)
    })

    it('下载也不跟软链', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      await symlink(path.join(outside, 'secret.md'), path.join(projectDir, 'media', 'leak.md'))

      await expect(service.download(PROJECT_ID, USER_ID, 'media/leak.md'))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })
    })
  })
})
