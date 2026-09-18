import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectDirService } from './project-dir.service'

const mocks = vi.hoisted(() => ({
  config: { projects: { root: '' } },
  claudeMdWriteFails: { value: false },
}))

vi.mock('../../config', () => ({ config: mocks.config }))

// 写入是在已校验目录里用相对文件名同步打开的（safe-fs 的 withLockedCwd），造故障要从这一层下手
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual,
    openSync: (file: string, ...rest: unknown[]) => {
      if (mocks.claudeMdWriteFails.value && String(file).endsWith('CLAUDE.md'))
        throw new Error('disk is on fire')

      return (actual.openSync as (...args: unknown[]) => number)(file, ...rest)
    },
  }
})

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  }
  catch {
    return false
  }
}

describe('project dir service', () => {
  let root = ''
  let outside = ''
  let service: ProjectDirService

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'aitoearn-projects-'))
    outside = await mkdtemp(path.join(tmpdir(), 'aitoearn-outside-'))
    mocks.config.projects.root = root
    mocks.claudeMdWriteFails.value = false
    service = new ProjectDirService()
  })

  afterEach(async () => {
    mocks.claudeMdWriteFails.value = false
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('creates the whole material directory tree with .gitkeep and CLAUDE.md', async () => {
    const projectDir = await service.createProjectDir({
      name: 'fortyweeks',
      displayName: '四十周',
      desc: '备孕到生产的记录工具',
      audience: '备孕中的夫妻',
      goal: '',
    })

    expect(projectDir).toBe(path.join(root, 'fortyweeks'))

    const expectedDirs = [
      'background/product',
      'background/website',
      'background/feedback',
      'background/legal',
      'angles',
      'drafts',
      'media',
    ]
    for (const dir of expectedDirs) {
      expect(await exists(path.join(projectDir, dir)), dir).toBe(true)
      expect(await exists(path.join(projectDir, dir, '.gitkeep')), `${dir}/.gitkeep`).toBe(true)
    }

    const claudeMd = await readFile(path.join(projectDir, 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('# 四十周')
    expect(claudeMd).toContain('- 英文名：fortyweeks')
    expect(claudeMd).toContain('- 说明：备孕到生产的记录工具')
    expect(claudeMd).toContain('- 面向谁：备孕中的夫妻')
    // 空字段写「（未填写）」
    expect(claudeMd).toContain('- 想达成什么：（未填写）')
    expect(claudeMd).not.toContain('{displayName}')
  })

  it('cleans up everything when a step fails halfway', async () => {
    mocks.claudeMdWriteFails.value = true

    await expect(service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' }))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectDirCreateFailed })

    // 半成品必须清理干净
    expect(await readdir(root)).toEqual([])
  })

  it('reports an existing directory as a taken name and keeps its content', async () => {
    // 数据库里没记录、磁盘上却有同名目录（例如上次部署留下的孤儿目录）
    const existing = path.join(root, 'fortyweeks')
    await mkdir(existing, { recursive: true })
    await writeFile(path.join(existing, 'keep-me.md'), 'old material', 'utf8')

    await expect(service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' }))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectNameTaken })

    // 行为不变：已有目录不许被覆盖或删除
    expect(await readFile(path.join(existing, 'keep-me.md'), 'utf8')).toBe('old material')
  })

  it('rejects paths that escape the project root', async () => {
    const escaped = { code: ResponseCode.ProjectPathEscape }

    await expect(service.resolveProjectPath('../evil')).rejects.toMatchObject(escaped)
    await expect(service.resolveProjectPath('fortyweeks', '../../etc/passwd')).rejects.toMatchObject(escaped)
    await expect(service.resolveProjectPath('/etc/passwd')).rejects.toMatchObject(escaped)
  })

  it('rejects symlinks that point outside the project root', async () => {
    const escaped = { code: ResponseCode.ProjectPathEscape }
    await writeFile(path.join(outside, 'secret.md'), 'top secret', 'utf8')
    await symlink(outside, path.join(root, 'escape-hatch'), 'junction')

    // 链接本身、链接下已存在的文件、链接下还没建出来的路径，三种都要挡住
    await expect(service.resolveProjectPath('escape-hatch')).rejects.toMatchObject(escaped)
    await expect(service.resolveProjectPath('escape-hatch', 'secret.md')).rejects.toMatchObject(escaped)
    await expect(service.resolveProjectPath('escape-hatch', 'drafts', 'new.md')).rejects.toMatchObject(escaped)
    await expect(service.createProjectDir({ name: 'escape-hatch', displayName: '越界' })).rejects.toMatchObject(escaped)

    // 目标目录里的东西一根毛都不能少
    expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('top secret')
  })

  it('rejects symlinks hidden in the middle of the path and symlinked files', async () => {
    const escaped = { code: ResponseCode.ProjectPathEscape }
    await mkdir(path.join(root, 'fortyweeks', 'drafts'), { recursive: true })
    await writeFile(path.join(outside, 'secret.md'), 'top secret', 'utf8')
    // 中间层软链
    await symlink(outside, path.join(root, 'fortyweeks', 'drafts', 'bridge'), 'junction')
    // 文件级软链
    await symlink(path.join(outside, 'secret.md'), path.join(root, 'fortyweeks', 'secret-link.md'))

    await expect(service.resolveProjectPath('fortyweeks', 'drafts', 'bridge', 'x.md')).rejects.toMatchObject(escaped)
    await expect(service.resolveProjectPath('fortyweeks', 'secret-link.md')).rejects.toMatchObject(escaped)
  })

  it('rejects dangling symlinks that point outside the project root', async () => {
    const escaped = { code: ResponseCode.ProjectPathEscape }
    // 悬空软链：目标文件还没建出来，realpath 直接报 ENOENT，
    // 但写入时系统会顺着软链把文件落到根目录外面
    const leak = path.join(root, 'leak.md')
    await symlink(path.join(outside, 'leak.md'), leak)

    await expect(service.resolveProjectPath('leak.md')).rejects.toMatchObject(escaped)

    // 悬空的目录软链，连它下面还没建出来的层级一起挡住
    await symlink(path.join(outside, 'not-yet'), path.join(root, 'dangling-dir'))
    await expect(service.resolveProjectPath('dangling-dir')).rejects.toMatchObject(escaped)
    await expect(service.resolveProjectPath('dangling-dir', 'drafts', 'new.md')).rejects.toMatchObject(escaped)
    await expect(service.createProjectDir({ name: 'leak.md', displayName: '越界' })).rejects.toMatchObject(escaped)

    // 根目录外面一个文件都不许被创建出来
    expect(await exists(path.join(outside, 'leak.md'))).toBe(false)
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects dangling symlinks written as a relative path', async () => {
    const escaped = { code: ResponseCode.ProjectPathEscape }
    // 相对软链要相对于它所在目录解析，形如 ../aitoearn-outside-xxx/leak.md
    const relativeTarget = path.relative(root, path.join(outside, 'leak.md'))
    expect(relativeTarget.startsWith('..')).toBe(true)
    await symlink(relativeTarget, path.join(root, 'relative-leak.md'))

    await expect(service.resolveProjectPath('relative-leak.md')).rejects.toMatchObject(escaped)
    expect(await exists(path.join(outside, 'leak.md'))).toBe(false)
  })

  it('rejects chained dangling symlinks and symlink loops', async () => {
    const escaped = { code: ResponseCode.ProjectPathEscape }
    // 软链套软链，最后一跳落在根目录外
    await symlink(path.join(outside, 'leak.md'), path.join(root, 'hop-2'))
    await symlink(path.join(root, 'hop-2'), path.join(root, 'hop-1'))
    await expect(service.resolveProjectPath('hop-1')).rejects.toMatchObject(escaped)

    // 软链成环
    await symlink(path.join(root, 'loop-b'), path.join(root, 'loop-a'))
    await symlink(path.join(root, 'loop-a'), path.join(root, 'loop-b'))
    await expect(service.resolveProjectPath('loop-a')).rejects.toMatchObject(escaped)
  })

  it('allows dangling symlinks that point back inside the project root', async () => {
    // 同样是 realpath 读不到的悬空软链，但落点在根目录里，属于合法场景
    await mkdir(path.join(root, 'fortyweeks', 'drafts'), { recursive: true })
    await symlink(path.join(root, 'fortyweeks', 'drafts', 'new.md'), path.join(root, 'inbox.md'))

    await expect(service.resolveProjectPath('inbox.md'))
      .resolves
      .toBe(path.join(root, 'inbox.md'))
  })

  it('allows symlinks that stay inside the project root', async () => {
    await mkdir(path.join(root, 'fortyweeks', 'drafts'), { recursive: true })
    await symlink(path.join(root, 'fortyweeks'), path.join(root, 'shortcut'), 'junction')

    await expect(service.resolveProjectPath('shortcut', 'drafts'))
      .resolves
      .toBe(path.join(root, 'shortcut', 'drafts'))
  })

  it('allows paths that have not been created yet', async () => {
    // 多级新路径、还没建出来的新文件、全新项目名、根目录本身，都不该被误伤
    await expect(service.resolveProjectPath()).resolves.toBe(root)
    await expect(service.resolveProjectPath('brand-new'))
      .resolves
      .toBe(path.join(root, 'brand-new'))
    await expect(service.resolveProjectPath('brand-new', 'background', 'product', 'a.md'))
      .resolves
      .toBe(path.join(root, 'brand-new', 'background', 'product', 'a.md'))
  })

  it('still resolves when the root directory has not been created yet', async () => {
    // 第一次部署时根目录可能还不存在，不能因为「解析不出真实路径」就一律拒绝
    const missingRoot = path.join(outside, 'not-created-yet', 'projects')
    mocks.config.projects.root = missingRoot

    await expect(service.resolveProjectPath('fortyweeks'))
      .resolves
      .toBe(path.join(missingRoot, 'fortyweeks'))

    await expect(service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' }))
      .resolves
      .toBe(path.join(missingRoot, 'fortyweeks'))
  })

  it('works when the project root itself is a symlink', async () => {
    // 服务器上根目录本身是软链很常见，必须放行
    const linkedRoot = path.join(outside, 'projects-link')
    await symlink(root, linkedRoot, 'junction')
    mocks.config.projects.root = linkedRoot

    await expect(service.resolveProjectPath('fortyweeks', 'drafts', 'new.md'))
      .resolves
      .toBe(path.join(linkedRoot, 'fortyweeks', 'drafts', 'new.md'))

    const projectDir = await service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' })

    expect(projectDir).toBe(path.join(linkedRoot, 'fortyweeks'))
    expect(await exists(path.join(root, 'fortyweeks', 'CLAUDE.md'))).toBe(true)
  })

  it('renames the directory on archive without deleting files', async () => {
    await service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' })

    const renamed = await service.renameProjectDir('fortyweeks', '_archived_fortyweeks_20260918090503')

    expect(renamed).toBe(true)
    expect(await exists(path.join(root, 'fortyweeks'))).toBe(false)
    expect(await exists(path.join(root, '_archived_fortyweeks_20260918090503', 'CLAUDE.md'))).toBe(true)
  })

  it('does not fail when the directory to rename is already gone', async () => {
    await expect(service.renameProjectDir('missing', '_archived_missing_20260918090503'))
      .resolves
      .toBe(false)
  })

  it('reports rename failures with its own error code', async () => {
    await service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' })
    // 目标是个非空目录，改名必然失败
    const occupied = path.join(root, '_archived_fortyweeks_20260918090503')
    await mkdir(occupied, { recursive: true })
    await writeFile(path.join(occupied, 'keep-me.md'), 'old archive', 'utf8')

    await expect(service.renameProjectDir('fortyweeks', '_archived_fortyweeks_20260918090503'))
      .rejects
      .toMatchObject({ code: ResponseCode.ProjectDirRenameFailed })
  })

  it('rewrites CLAUDE.md after the project info changes', async () => {
    await service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' })

    const ok = await service.refreshClaudeMd('fortyweeks', {
      name: 'fortyweeks',
      displayName: '四十周孕期',
      desc: '新的说明',
      audience: '新的受众',
      goal: '新的目标',
    })

    expect(ok).toBe(true)
    const claudeMd = await readFile(path.join(root, 'fortyweeks', 'CLAUDE.md'), 'utf8')
    expect(claudeMd).toContain('# 四十周孕期')
    expect(claudeMd).toContain('- 说明：新的说明')
    expect(claudeMd).toContain('- 面向谁：新的受众')
    expect(claudeMd).toContain('- 想达成什么：新的目标')
  })

  it('does not throw when CLAUDE.md cannot be rewritten', async () => {
    await expect(service.refreshClaudeMd('missing', { name: 'missing', displayName: '不存在' }))
      .resolves
      .toBe(false)
  })

  it('removes the project directory on rollback', async () => {
    await service.createProjectDir({ name: 'fortyweeks', displayName: '四十周' })

    await service.removeProjectDir('fortyweeks')

    expect(await exists(path.join(root, 'fortyweeks'))).toBe(false)
  })
})
