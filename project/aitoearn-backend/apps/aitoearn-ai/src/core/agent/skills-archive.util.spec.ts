/**
 * 技能包解压的纯规则。真 zip 喂进去的整链路测试在 `skills-store.util.spec.ts`。
 */

import { AppException, ResponseCode } from '@yikart/common'
import { describe, expect, it } from 'vitest'
import {
  ArchiveByteBudget,
  detectSkillRootPrefix,
  hasConflictingPaths,
  isIgnoredArchiveEntry,
  isUnsafeUnixFileType,
  MAX_SKILL_ARCHIVE_FILE_BYTES,
  MAX_SKILL_UNPACKED_BYTES,
  normalizeArchiveEntryPath,
  readUnixFileType,
  skillFileMode,
} from './skills-archive.util'

function expectCode(fn: () => unknown, code: ResponseCode): void {
  try {
    fn()
  }
  catch (error) {
    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe(code)
    return
  }
  throw new Error(`期望抛出 ${ResponseCode[code]}，但没有抛出`)
}

/** unix mode 放进 externalFileAttributes 的高 16 位 */
function attrs(mode: number): number {
  return (mode << 16) >>> 0
}

describe('normalizeArchiveEntryPath 条目路径', () => {
  it.each([
    ['SKILL.md', 'SKILL.md'],
    ['references/api.md', 'references/api.md'],
    ['my-skill/scripts/run.sh', 'my-skill/scripts/run.sh'],
    ['./SKILL.md', 'SKILL.md'],
    ['a/./b.md', 'a/b.md'],
    ['references/', 'references'],
    ['中文/说明.md', '中文/说明.md'],
  ])('放行并统一成 posix 相对路径: %s', (raw, expected) => {
    expect(normalizeArchiveEntryPath(raw)).toBe(expected)
  })

  it('只剩根目录本身时返回空串，交给调用方判断', () => {
    expect(normalizeArchiveEntryPath('./')).toBe('')
  })

  it.each([
    ['', '空名'],
    ['/etc/passwd', '绝对路径'],
    ['../evil.txt', '开头回退'],
    ['a/../../evil.txt', '中间回退'],
    ['a/..', '结尾回退'],
    ['a\\b.txt', '反斜杠'],
    ['..\\evil.txt', '反斜杠回退'],
    ['C:/Windows/evil.txt', '盘符'],
    ['c:evil.txt', '小写盘符不带斜杠'],
    ['a/D:/evil.txt', '中间一段像盘符'],
    ['a\0b.txt', 'NUL'],
    ['a\nb.txt', '换行'],
    ['a\u007Fb.txt', 'DEL'],
    ['a//b.txt', '空段'],
  ])('拒绝 %j（%s）', (raw) => {
    expect(normalizeArchiveEntryPath(raw)).toBeNull()
  })
})

describe('isIgnoredArchiveEntry macOS 打包的附带物', () => {
  it.each([
    ['__MACOSX'],
    ['__MACOSX/my-skill/._SKILL.md'],
    ['.DS_Store'],
    ['my-skill/.DS_Store'],
    ['my-skill/references/.DS_Store'],
  ])('忽略 %s', (relPath) => {
    expect(isIgnoredArchiveEntry(relPath)).toBe(true)
  })

  it.each([
    ['SKILL.md'],
    ['my-skill/__MACOSX_notes.md'],
    ['my-skill/.env.example'],
    ['DS_Store'],
  ])('不误伤 %s', (relPath) => {
    expect(isIgnoredArchiveEntry(relPath)).toBe(false)
  })
})

describe('unix 文件类型 软链不收', () => {
  it('读出高 16 位里的类型位', () => {
    expect(readUnixFileType(attrs(0o100644))).toBe(0o100000)
    expect(readUnixFileType(attrs(0o040755))).toBe(0o040000)
    expect(readUnixFileType(attrs(0o120777))).toBe(0o120000)
    expect(readUnixFileType(0x20)).toBe(0)
  })

  it('普通文件、目录、没设类型（Windows 打的包）放行', () => {
    expect(isUnsafeUnixFileType(0o100000)).toBe(false)
    expect(isUnsafeUnixFileType(0o040000)).toBe(false)
    expect(isUnsafeUnixFileType(0)).toBe(false)
  })

  it.each([
    [0o120000, '软链'],
    [0o010000, '管道'],
    [0o020000, '字符设备'],
    [0o060000, '块设备'],
    [0o140000, 'socket'],
  ])('拒绝 %o（%s）', (type) => {
    expect(isUnsafeUnixFileType(type)).toBe(true)
  })
})

describe('detectSkillRootPrefix 认技能根目录', () => {
  it('包根目录就有 SKILL.md → 前缀为空', () => {
    expect(detectSkillRootPrefix(['SKILL.md', 'references/a.md', 'scripts/run.sh'])).toBe('')
  })

  it('根目录有 SKILL.md 时，旁边有别的文件夹也无所谓', () => {
    expect(detectSkillRootPrefix(['SKILL.md', 'a/x.md', 'b/y.md'])).toBe('')
  })

  it('唯一的顶层文件夹里有 SKILL.md → 剥掉这一层（Finder 压缩出来的样子）', () => {
    expect(detectSkillRootPrefix(['whatever/SKILL.md', 'whatever/references/a.md'])).toBe('whatever/')
  })

  it('多个顶层文件夹 → 认不出来', () => {
    expect(detectSkillRootPrefix(['a/SKILL.md', 'b/SKILL.md'])).toBeNull()
  })

  it('顶层文件夹旁边还有散文件 → 认不出来', () => {
    expect(detectSkillRootPrefix(['a/SKILL.md', 'README.md'])).toBeNull()
  })

  it('入口藏在两层以下 → 认不出来', () => {
    expect(detectSkillRootPrefix(['a/b/SKILL.md'])).toBeNull()
  })

  it('大小写不对不认（Agent 只认 SKILL.md）', () => {
    expect(detectSkillRootPrefix(['skill.md'])).toBeNull()
  })

  it('空包 → 认不出来', () => {
    expect(detectSkillRootPrefix([])).toBeNull()
  })
})

describe('hasConflictingPaths 条目撞名', () => {
  it('互不相干放行', () => {
    expect(hasConflictingPaths(['SKILL.md', 'references/a.md', 'references/b.md'])).toBe(false)
  })

  it('同名两份', () => {
    expect(hasConflictingPaths(['SKILL.md', 'SKILL.md'])).toBe(true)
  })

  it('一个路径既是文件又是别的文件的父目录', () => {
    expect(hasConflictingPaths(['references', 'references/a.md'])).toBe(true)
    expect(hasConflictingPaths(['a/b', 'a/b/c/d.md'])).toBe(true)
  })
})

describe('skillFileMode 落盘权限', () => {
  it('scripts/ 下 0755，其余 0644', () => {
    expect(skillFileMode('scripts/run.sh')).toBe(0o755)
    expect(skillFileMode('scripts/lib/util.py')).toBe(0o755)
    expect(skillFileMode('SKILL.md')).toBe(0o644)
    expect(skillFileMode('references/scripts/a.md')).toBe(0o644)
  })
})

describe('archiveByteBudget 按实际字节记账', () => {
  it('单文件刚好到上限放行，多一个字节就拒', () => {
    const budget = new ArchiveByteBudget()
    budget.beginFile()
    budget.consume(MAX_SKILL_ARCHIVE_FILE_BYTES)
    expectCode(() => budget.consume(1), ResponseCode.SkillArchiveTooLarge)
  })

  it('一块一块累计，不看声明值', () => {
    const budget = new ArchiveByteBudget()
    budget.beginFile()
    const chunk = 64 * 1024
    const chunks = MAX_SKILL_ARCHIVE_FILE_BYTES / chunk
    for (let i = 0; i < chunks; i++)
      budget.consume(chunk)
    expectCode(() => budget.consume(chunk), ResponseCode.SkillArchiveTooLarge)
  })

  it('换文件单文件计数清零，但总量一直累计', () => {
    const budget = new ArchiveByteBudget()
    const perFile = 8 * 1024 * 1024
    const filesUnderTotal = Math.floor(MAX_SKILL_UNPACKED_BYTES / perFile)
    for (let i = 0; i < filesUnderTotal; i++) {
      budget.beginFile()
      budget.consume(perFile)
    }
    budget.beginFile()
    expectCode(() => budget.consume(perFile), ResponseCode.SkillArchiveTooLarge)
  })
})
