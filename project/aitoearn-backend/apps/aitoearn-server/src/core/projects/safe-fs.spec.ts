import { renameSync, rmSync, symlinkSync } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  safeLstat,
  safeMkdir,
  safeMkdirp,
  safeReaddir,
  safeReadFile,
  safeRemove,
  safeRename,
  safeWriteFile,
} from './safe-fs'

/**
 * 竞态钩子：在真正动手之前插一脚，用来把「并发换软链」造成可复现的用例。
 * 不这么做只能靠反复循环碰运气，测试会飘。
 *
 * 下钻目录走的是异步 `open`（node:fs/promises），真正改盘的动作走同步调用（node:fs），
 * 两条都得能挂钩子。同步那条的回调也必须是同步的——被钩的代码本身就在不能 await 的窗口里。
 */
const mocks = vi.hoisted(() => ({
  beforeOpen: { fn: null as null | ((target: string) => Promise<void>) },
  beforeSync: { fn: null as null | ((op: string, target: string) => void) },
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    default: actual,
    open: async (target: string, ...rest: unknown[]) => {
      await mocks.beforeOpen.fn?.(String(target))
      return await (actual.open as (...args: unknown[]) => Promise<unknown>)(target, ...rest)
    },
  }
})

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  const hook = <T extends (...args: never[]) => unknown>(op: string, real: T): T =>
    ((...args: unknown[]) => {
      mocks.beforeSync.fn?.(op, String(args[0]))
      return (real as (...inner: unknown[]) => unknown)(...args)
    }) as unknown as T

  return {
    ...actual,
    default: actual,
    openSync: hook('openSync', actual.openSync),
    mkdirSync: hook('mkdirSync', actual.mkdirSync),
    renameSync: hook('renameSync', actual.renameSync),
    unlinkSync: hook('unlinkSync', actual.unlinkSync),
    lstatSync: hook('lstatSync', actual.lstatSync),
    readdirSync: hook('readdirSync', actual.readdirSync),
  }
})

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  }
  catch {
    return false
  }
}

describe('safe-fs 对抗测试', () => {
  let root = ''
  let outside = ''
  let projectDir = ''

  beforeEach(async () => {
    mocks.beforeOpen.fn = null
    mocks.beforeSync.fn = null
    root = await mkdtemp(path.join(tmpdir(), 'aitoearn-safefs-'))
    outside = await mkdtemp(path.join(tmpdir(), 'aitoearn-outside-'))
    projectDir = path.join(root, 'proj')
    await mkdir(path.join(projectDir, 'media'), { recursive: true })
  })

  afterEach(async () => {
    mocks.beforeOpen.fn = null
    mocks.beforeSync.fn = null
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  describe('正常用法', () => {
    it('写得进去也读得回来', async () => {
      const written = await safeWriteFile(root, ['proj', 'media', 'a.md'], Buffer.from('物料', 'utf8'))
      expect(written.size).toBeGreaterThan(0)

      const read = await safeReadFile(root, ['proj', 'media', 'a.md'], 1024)
      expect(read.content.toString('utf8')).toBe('物料')
    })

    it('覆盖写不会留下旧内容的尾巴', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('很长很长的旧内容', 'utf8'))
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('新', 'utf8'))

      const read = await safeReadFile(root, ['proj', 'a.md'], 1024)
      expect(read.content.toString('utf8')).toBe('新')
    })

    it('写空内容也不报错，文件长度归零', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('有内容', 'utf8'))
      const written = await safeWriteFile(root, ['proj', 'a.md'], Buffer.alloc(0))

      expect(written.size).toBe(0)
      expect(await readFile(path.join(projectDir, 'a.md'), 'utf8')).toBe('')
    })

    it('独占写在目标已存在时报「已存在」', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('x', 'utf8'))

      await expect(safeWriteFile(root, ['proj', 'a.md'], Buffer.from('y', 'utf8'), { exclusive: true }))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileExists })

      const read = await safeReadFile(root, ['proj', 'a.md'], 1024)
      expect(read.content.toString('utf8')).toBe('x')
    })

    it('逐级建目录，列目录按目录在前排序', async () => {
      await safeMkdirp(root, ['proj', 'background', 'product'])
      await safeWriteFile(root, ['proj', 'background', 'note.md'], Buffer.from('n', 'utf8'))

      const entries = await safeReaddir(root, ['proj', 'background'], 'background')
      expect(entries.map(e => `${e.type}:${e.name}`)).toEqual(['dir:product', 'file:note.md'])
      expect(entries[0]!.relPath).toBe('background/product')
      expect(entries[0]!.size).toBeNull()
    })

    it('改名和删除都走得通', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('x', 'utf8'))
      await safeRename(root, ['proj', 'a.md'], ['proj', 'media', 'b.md'])

      expect(await exists(path.join(projectDir, 'a.md'))).toBe(false)
      expect(await exists(path.join(projectDir, 'media', 'b.md'))).toBe(true)

      await safeRemove(root, ['proj', 'media'])
      expect(await exists(path.join(projectDir, 'media'))).toBe(false)
    })

    it('同目录内改名也走得通', async () => {
      await safeWriteFile(root, ['proj', 'media', 'a.md'], Buffer.from('x', 'utf8'))
      await safeRename(root, ['proj', 'media', 'a.md'], ['proj', 'media', 'b.md'])

      expect(await exists(path.join(projectDir, 'media', 'a.md'))).toBe(false)
      expect(await readFile(path.join(projectDir, 'media', 'b.md'), 'utf8')).toBe('x')
    })

    it('递归删多层目录，删干净', async () => {
      await safeMkdirp(root, ['proj', 'media', 'sub', 'deep'])
      await safeWriteFile(root, ['proj', 'media', 'sub', 'deep', 'a.md'], Buffer.from('x', 'utf8'))
      await safeWriteFile(root, ['proj', 'media', 'sub', 'b.md'], Buffer.from('x', 'utf8'))

      await safeRemove(root, ['proj', 'media'])

      expect(await exists(path.join(projectDir, 'media'))).toBe(false)
      expect(await readdir(projectDir)).toEqual([])
    })
  })

  describe('路径段自己也要校验，不能只靠调用方', () => {
    it('`..` 段一律拒绝，不靠 path.join 静悄悄折叠', async () => {
      const invalid = { code: ResponseCode.ProjectFilePathInvalid }

      await expect(safeReaddir(root, ['..'], '')).rejects.toMatchObject(invalid)
      await expect(safeReadFile(root, ['proj', '..', 'proj', 'a.md'], 1024)).rejects.toMatchObject(invalid)
      await expect(safeWriteFile(root, ['proj', '..', 'x.md'], Buffer.from('x', 'utf8'))).rejects.toMatchObject(invalid)
      await expect(safeMkdir(root, ['proj', '..', 'evil'])).rejects.toMatchObject(invalid)
      await expect(safeRemove(root, ['proj', '..'])).rejects.toMatchObject(invalid)
      await expect(safeLstat(root, ['.'])).rejects.toMatchObject(invalid)
      expect(await readdir(root)).toEqual(['proj'])
    })

    it('带分隔符和绝对路径的段一律拒绝', async () => {
      const invalid = { code: ResponseCode.ProjectFilePathInvalid }

      await expect(safeWriteFile(root, ['proj/media', 'x.md'], Buffer.from('x', 'utf8'))).rejects.toMatchObject(invalid)
      await expect(safeWriteFile(root, ['proj', '/etc/passwd'], Buffer.from('x', 'utf8'))).rejects.toMatchObject(invalid)
      await expect(safeWriteFile(root, ['proj', ''], Buffer.from('x', 'utf8'))).rejects.toMatchObject(invalid)
    })
  })

  describe('已经埋好的软链', () => {
    it('写入时最后一段是指向外面的软链，直接拒绝', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      await symlink(path.join(outside, 'secret.md'), path.join(projectDir, 'leak.md'))

      await expect(safeWriteFile(root, ['proj', 'leak.md'], Buffer.from('污染', 'utf8')))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('机密')
    })

    it('写入时最后一段是悬空软链，根目录外一个字节都落不下去', async () => {
      await symlink(path.join(outside, 'new.md'), path.join(projectDir, 'dangling.md'))

      await expect(safeWriteFile(root, ['proj', 'dangling.md'], Buffer.from('污染', 'utf8')))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      expect(await readdir(outside)).toEqual([])
    })

    it('中间层是软链，读写建目录一律拒绝', async () => {
      await symlink(outside, path.join(projectDir, 'bridge'), 'junction')

      const symlinkError = { code: ResponseCode.ProjectFileIsSymlink }
      await expect(safeWriteFile(root, ['proj', 'bridge', 'x.md'], Buffer.from('x', 'utf8'))).rejects.toMatchObject(symlinkError)
      await expect(safeMkdir(root, ['proj', 'bridge', 'sub'])).rejects.toMatchObject(symlinkError)
      await expect(safeReaddir(root, ['proj', 'bridge'], 'bridge')).rejects.toMatchObject(symlinkError)
      await expect(safeReadFile(root, ['proj', 'bridge', 'x.md'], 1024)).rejects.toMatchObject(symlinkError)

      expect(await readdir(outside)).toEqual([])
    })

    it('读文件不跟软链', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      await symlink(path.join(outside, 'secret.md'), path.join(projectDir, 'peek.md'))

      await expect(safeReadFile(root, ['proj', 'peek.md'], 1024))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })
    })

    it('硬链接把外面的文件拽进来，同样拒绝写', async () => {
      const secret = path.join(outside, 'secret.md')
      await writeFile(secret, '机密', 'utf8')
      await link(secret, path.join(projectDir, 'hard.md'))

      await expect(safeWriteFile(root, ['proj', 'hard.md'], Buffer.from('污染', 'utf8')))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      expect(await readFile(secret, 'utf8')).toBe('机密')
    })

    it('列目录不展示软链', async () => {
      await writeFile(path.join(projectDir, 'real.md'), 'r', 'utf8')
      await symlink(outside, path.join(projectDir, 'bridge'), 'junction')
      await symlink(path.join(outside, 'secret.md'), path.join(projectDir, 'leak.md'))

      const entries = await safeReaddir(root, ['proj'], '')
      expect(entries.map(e => e.name)).toEqual(['media', 'real.md'])
    })

    it('改名不接受软链当源', async () => {
      await symlink(outside, path.join(projectDir, 'bridge'), 'junction')

      await expect(safeRename(root, ['proj', 'bridge'], ['proj', 'moved']))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })
    })
  })

  describe('删除软链只摘链接，不跟进去', () => {
    it('文件软链：链接没了，被指的文件还在', async () => {
      const secret = path.join(outside, 'secret.md')
      await writeFile(secret, '机密', 'utf8')
      await symlink(secret, path.join(projectDir, 'leak.md'))

      await safeRemove(root, ['proj', 'leak.md'])

      expect(await exists(path.join(projectDir, 'leak.md'))).toBe(false)
      expect(await readFile(secret, 'utf8')).toBe('机密')
    })

    it('目录软链：链接没了，被指的目录里的东西一样不少', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      await symlink(outside, path.join(projectDir, 'bridge'), 'junction')

      await safeRemove(root, ['proj', 'bridge'])

      expect(await exists(path.join(projectDir, 'bridge'))).toBe(false)
      expect(await readdir(outside)).toEqual(['secret.md'])
    })

    it('递归删目录时碰到软链也只摘链接', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      await symlink(outside, path.join(projectDir, 'media', 'bridge'), 'junction')
      await writeFile(path.join(projectDir, 'media', 'own.md'), 'o', 'utf8')

      await safeRemove(root, ['proj', 'media'])

      expect(await exists(path.join(projectDir, 'media'))).toBe(false)
      expect(await readdir(outside)).toEqual(['secret.md'])
      expect(await readFile(path.join(outside, 'secret.md'), 'utf8')).toBe('机密')
    })
  })

  describe('tOCTOU：动手过程中把路径换成软链', () => {
    /** 把已经通过校验的 `proj` 目录挪开，原位换成指向根目录外的软链 */
    function swapProjectDirForSymlinkSync(): void {
      renameSync(projectDir, path.join(root, 'proj-real'))
      symlinkSync(outside, projectDir, 'junction')
    }

    it('写文件：真正落盘前整个父目录被换成软链，拒绝且外面不留残渣', async () => {
      mocks.beforeSync.fn = (op, target) => {
        if (op !== 'openSync' || target !== 'race.md')
          return

        mocks.beforeSync.fn = null
        swapProjectDirForSymlinkSync()
      }

      await expect(safeWriteFile(root, ['proj', 'race.md'], Buffer.from('污染', 'utf8')))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      // 内容没落到外面，连空文件都不许留下
      expect(await readdir(outside)).toEqual([])
    })

    it('建目录：中间层在下钻途中被换成软链，拒绝且外面不多出目录', async () => {
      await safeMkdirp(root, ['proj', 'background'])

      mocks.beforeOpen.fn = async (target) => {
        // 刚打开 proj 这一级，就把它下面的 background 换成指向外面的软链
        if (!target.endsWith(`${path.sep}proj`))
          return

        mocks.beforeOpen.fn = null
        await rm(path.join(projectDir, 'background'), { recursive: true, force: true })
        await symlink(outside, path.join(projectDir, 'background'), 'junction')
      }

      await expect(safeMkdir(root, ['proj', 'background', 'product']))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      expect(await readdir(outside)).toEqual([])
    })

    it('建目录：真正 mkdir 之前父目录被换成软链，拒绝且外面不多出目录', async () => {
      mocks.beforeSync.fn = (op, target) => {
        if (op !== 'mkdirSync' || target !== 'product')
          return

        mocks.beforeSync.fn = null
        swapProjectDirForSymlinkSync()
      }

      await expect(safeMkdir(root, ['proj', 'product']))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      expect(await readdir(outside)).toEqual([])
    })

    it('覆盖写：已有文件在写之前被整个目录掉包，拒绝且不改动外面的同名文件', async () => {
      await safeWriteFile(root, ['proj', 'race.md'], Buffer.from('原内容', 'utf8'))
      await writeFile(path.join(outside, 'race.md'), '外面的内容', 'utf8')

      mocks.beforeSync.fn = (op, target) => {
        if (op !== 'openSync' || target !== 'race.md')
          return

        mocks.beforeSync.fn = null
        swapProjectDirForSymlinkSync()
      }

      await expect(safeWriteFile(root, ['proj', 'race.md'], Buffer.from('污染', 'utf8')))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileIsSymlink })

      expect(await readFile(path.join(outside, 'race.md'), 'utf8')).toBe('外面的内容')
    })

    it('改名：落点目录在 rename 之前被换成软链，东西搬不出根目录', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('内容', 'utf8'))

      mocks.beforeSync.fn = (op) => {
        if (op !== 'renameSync')
          return

        mocks.beforeSync.fn = null
        rmSync(path.join(projectDir, 'media'), { recursive: true, force: true })
        symlinkSync(outside, path.join(projectDir, 'media'), 'junction')
      }

      await safeRename(root, ['proj', 'a.md'], ['proj', 'media', 'b.md']).catch(() => undefined)

      expect(await readdir(outside)).toEqual([])
    })

    it('删除：下钻途中把子目录换成指向外面的软链，整单拒绝且外面一个文件都没少', async () => {
      await writeFile(path.join(outside, 'secret.md'), '机密', 'utf8')
      const sub = path.join(projectDir, 'media', 'sub')
      await mkdir(sub, { recursive: true })
      await writeFile(path.join(sub, 'own.md'), 'o', 'utf8')

      const realChdir = process.chdir.bind(process)
      let swapped = false
      vi.spyOn(process, 'chdir').mockImplementation((target: string) => {
        if (target === 'sub' && !swapped) {
          swapped = true
          rmSync(sub, { recursive: true, force: true })
          symlinkSync(outside, sub, 'junction')
        }
        realChdir(target)
      })

      await expect(safeRemove(root, ['proj', 'media']))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectPathEscape })

      expect(swapped).toBe(true)
      expect(await readdir(outside)).toEqual(['secret.md'])
    })

    it('先换成软链、再趁善后之前换回去，外面照样不留空文件', async () => {
      // 这是最阴的一手：让「创建」落到外面，再把路径换回来，好让按路径做的善后删不掉那个文件。
      // 现在创建本身就锚在校验过的目录上，压根不会落到外面，所以善后也一定删得掉。
      let swapped = false
      let restored = false

      mocks.beforeSync.fn = (op, target) => {
        if (op === 'openSync' && target.endsWith('race.md') && !swapped) {
          swapped = true
          swapProjectDirForSymlinkSync()
          return
        }

        // 善后要 lstat 的时候，攻击方已经把路径换回去了
        if (op === 'lstatSync' && target.endsWith('race.md') && swapped && !restored) {
          restored = true
          rmSync(projectDir, { recursive: true, force: true })
          renameSync(path.join(root, 'proj-real'), projectDir)
        }
      }

      await expect(safeWriteFile(root, ['proj', 'race.md'], Buffer.from('污染', 'utf8')))
        .rejects
        .toThrow()

      expect(swapped).toBe(true)
      expect(restored).toBe(true)
      expect(await readdir(outside)).toEqual([])
      expect(await readdir(projectDir)).toEqual(['media'])
    })

    it('反复并发地删掉再换成软链，内容一次都没漏到根目录外', async () => {
      const target = path.join(projectDir, 'media')
      const attacker = (async () => {
        for (let i = 0; i < 200; i++) {
          await rm(target, { recursive: true, force: true }).catch(() => {})
          await symlink(outside, target, 'junction').catch(() => {})
          await rm(target, { recursive: true, force: true }).catch(() => {})
          await mkdir(target, { recursive: true }).catch(() => {})
        }
      })()

      for (let i = 0; i < 200; i++) {
        await safeWriteFile(root, ['proj', 'media', `x-${i}.md`], Buffer.from('污染', 'utf8'))
          .catch(() => undefined)
      }
      await attacker

      // 外面既不该出现内容，也不该出现被创建出来的空文件
      expect(await readdir(outside)).toEqual([])
    })

    it('反复并发地把待删子目录换成软链，根目录外的文件一个都没被删掉', async () => {
      const keep = 30
      for (let i = 0; i < keep; i++)
        await writeFile(path.join(outside, `keep-${i}.md`), 'k', 'utf8')

      const media = path.join(projectDir, 'media')
      const sub = path.join(media, 'sub')
      const attacker = (async () => {
        for (let round = 0; round < 600; round++) {
          await rm(sub, { recursive: true, force: true }).catch(() => {})
          await symlink(outside, sub, 'junction').catch(() => {})
          await rm(sub, { recursive: true, force: true }).catch(() => {})
          await mkdir(sub, { recursive: true }).catch(() => {})
        }
      })()

      for (let i = 0; i < 150; i++) {
        await mkdir(path.join(sub, 'deep'), { recursive: true }).catch(() => {})
        await writeFile(path.join(sub, 'deep', 'own.md'), 'o', 'utf8').catch(() => {})
        await safeRemove(root, ['proj', 'media']).catch(() => undefined)
        await mkdir(media, { recursive: true }).catch(() => {})
      }

      await attacker

      // 外面的文件一个都不能少（测试自己顺着攻击方的软链造出来的目录不算）
      const left = new Set(await readdir(outside))
      for (let i = 0; i < keep; i++)
        expect(left.has(`keep-${i}.md`)).toBe(true)
    })
  })

  describe('其它边界', () => {
    it('根目录本身是软链属于合法部署，不误伤', async () => {
      const linkedRoot = path.join(outside, 'projects-link')
      await symlink(root, linkedRoot, 'junction')

      await safeWriteFile(linkedRoot, ['proj', 'a.md'], Buffer.from('x', 'utf8'))

      expect(await readFile(path.join(projectDir, 'a.md'), 'utf8')).toBe('x')
    })

    it('不存在的路径报「找不到」，不是报越界', async () => {
      await expect(safeReadFile(root, ['proj', 'nope.md'], 1024))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileNotFound })

      await expect(safeMkdir(root, ['proj', 'nope', 'sub']))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileNotFound })
    })

    it('把文件当目录用会被拒绝', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('x', 'utf8'))

      await expect(safeWriteFile(root, ['proj', 'a.md', 'b.md'], Buffer.from('x', 'utf8')))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFilePathInvalid })
    })

    it('超过上限的文本拒绝读，不把内容吞进内存', async () => {
      await safeWriteFile(root, ['proj', 'big.md'], Buffer.alloc(2048, 0x61))

      await expect(safeReadFile(root, ['proj', 'big.md'], 1024))
        .rejects
        .toMatchObject({ code: ResponseCode.ProjectFileTooLarge })
    })

    it('lstat 拿得到条目类型', async () => {
      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('x', 'utf8'))

      expect((await safeLstat(root, ['proj', 'a.md'])).isFile()).toBe(true)
      expect((await safeLstat(root, ['proj'])).isDirectory()).toBe(true)
      expect((await safeLstat(root, [])).isDirectory()).toBe(true)
    })

    it('操作完工作目录要还原回去', async () => {
      const before = process.cwd()

      await safeWriteFile(root, ['proj', 'a.md'], Buffer.from('x', 'utf8'))
      await safeMkdir(root, ['proj', 'sub'])
      await safeReaddir(root, ['proj'], '')
      await safeRemove(root, ['proj', 'sub'])
      await expect(safeWriteFile(root, ['proj', 'a.md', 'b.md'], Buffer.from('x', 'utf8'))).rejects.toThrow()

      expect(process.cwd()).toBe(before)
    })
  })
})
