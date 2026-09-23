import { describe, expect, it } from 'vitest'
import { MAX_SKILL_ARCHIVE_BYTES, MAX_SKILL_FILE_BYTES } from '@/api/skills/skill.constants'
import {
  getSkillErrorKey,
  hasExtraSkillFiles,
  summarizeSkillFiles,
  validateSkillFile,
} from './skills.utils'

describe('summarizeSkillFiles 结构摘要', () => {
  it('空的、没给的都收成全零，界面据此不摆摘要', () => {
    const empty = { hasEntry: false, dirs: [], rootOthers: 0, total: 0 }
    expect(summarizeSkillFiles([])).toEqual(empty)
    expect(summarizeSkillFiles(undefined)).toEqual(empty)
    expect(summarizeSkillFiles(null)).toEqual(empty)
  })

  it('只有 SKILL.md 时只标入口，不算「其他」，也不给展开', () => {
    const summary = summarizeSkillFiles(['SKILL.md'])

    expect(summary).toEqual({ hasEntry: true, dirs: [], rootOthers: 0, total: 1 })
    expect(hasExtraSkillFiles(summary)).toBe(false)
  })

  it('多个目录按第一段分组计数，按目录名排序', () => {
    const summary = summarizeSkillFiles([
      'scripts/run.py',
      'SKILL.md',
      'references/a.md',
      'assets/logo.png',
      'references/b.md',
      'references/c.md',
    ])

    expect(summary.hasEntry).toBe(true)
    expect(summary.dirs).toEqual([
      { name: 'assets', count: 1 },
      { name: 'references', count: 3 },
      { name: 'scripts', count: 1 },
    ])
    expect(summary.rootOthers).toBe(0)
    expect(summary.total).toBe(6)
    expect(hasExtraSkillFiles(summary)).toBe(true)
  })

  it('根目录下除 SKILL.md 以外的文件都算「其他」，大小写不对的 skill.md 也算', () => {
    const summary = summarizeSkillFiles(['LICENSE', 'README.md', 'SKILL.md', 'skill.md'])

    expect(summary).toEqual({ hasEntry: true, dirs: [], rootOthers: 3, total: 4 })
    expect(hasExtraSkillFiles(summary)).toBe(true)
  })

  it('嵌套多层只按第一段分组', () => {
    const summary = summarizeSkillFiles([
      'SKILL.md',
      'references/api/v1/users.md',
      'references/api/v2/users.md',
      'references/guide.md',
      'scripts/lib/deep/helper.sh',
    ])

    expect(summary.dirs).toEqual([
      { name: 'references', count: 3 },
      { name: 'scripts', count: 1 },
    ])
    expect(summary.rootOthers).toBe(0)
  })

  it('没有 SKILL.md 时照样统计其余文件，只是不标入口', () => {
    const summary = summarizeSkillFiles(['references/a.md', 'notes.txt'])

    expect(summary).toEqual({
      hasEntry: false,
      dirs: [{ name: 'references', count: 1 }],
      rootOthers: 1,
      total: 2,
    })
  })

  it('目录条目、空段、重复路径都不多算', () => {
    const summary = summarizeSkillFiles([
      'SKILL.md',
      'SKILL.md',
      'references/',
      'references//a.md',
      '/scripts/run.sh',
      '',
    ])

    expect(summary).toEqual({
      hasEntry: true,
      dirs: [
        { name: 'references', count: 1 },
        { name: 'scripts', count: 1 },
      ],
      rootOthers: 0,
      total: 3,
    })
  })
})

describe('validateSkillFile 本地预校验', () => {
  it('.zip 和 .md 在上限以内放行，扩展名不分大小写', () => {
    expect(validateSkillFile({ name: 'my-skill.zip', size: 1024 })).toBeNull()
    expect(validateSkillFile({ name: 'MY-SKILL.ZIP', size: MAX_SKILL_ARCHIVE_BYTES })).toBeNull()
    expect(validateSkillFile({ name: 'SKILL.md', size: MAX_SKILL_FILE_BYTES })).toBeNull()
    expect(validateSkillFile({ name: 'Skill.MD', size: 10 })).toBeNull()
  })

  it('其他扩展名一律 fileInvalid，大小不看', () => {
    expect(validateSkillFile({ name: 'notes.txt', size: 10 })).toBe('skills.error.fileInvalid')
    expect(validateSkillFile({ name: 'skill.tar.gz', size: 10 })).toBe('skills.error.fileInvalid')
    expect(validateSkillFile({ name: 'zip', size: 10 })).toBe('skills.error.fileInvalid')
    expect(validateSkillFile({ name: 'skill.md.exe', size: 10 })).toBe('skills.error.fileInvalid')
  })

  it('.zip 超 10 MiB、.md 超 64 KiB 都是 fileTooLarge，各按各的上限', () => {
    expect(validateSkillFile({ name: 'big.zip', size: MAX_SKILL_ARCHIVE_BYTES + 1 }))
      .toBe('skills.error.fileTooLarge')
    expect(validateSkillFile({ name: 'big.md', size: MAX_SKILL_FILE_BYTES + 1 }))
      .toBe('skills.error.fileTooLarge')
    // 70 KiB 的 zip 没问题，同样大小的 md 就超了
    expect(validateSkillFile({ name: 'ok.zip', size: 70 * 1024 })).toBeNull()
    expect(validateSkillFile({ name: 'big.md', size: 70 * 1024 })).toBe('skills.error.fileTooLarge')
  })
})

describe('getSkillErrorKey 错误码映射', () => {
  it.each([
    [20900, 'skills.error.nameInvalid'],
    [20901, 'skills.error.nameReserved'],
    [20902, 'skills.error.frontmatterMissing'],
    [20903, 'skills.error.fileTooLarge'],
    [20904, 'skills.error.fileInvalid'],
    [20905, 'skills.error.alreadyExists'],
    [20906, 'skills.error.notFound'],
    [20907, 'skills.error.builtinReadonly'],
    [20908, 'skills.error.storageUnavailable'],
    [20909, 'skills.error.archiveInvalid'],
    [20910, 'skills.error.archiveTooLarge'],
    [20911, 'skills.error.entryMissing'],
  ])('%i → %s', (code, key) => {
    expect(getSkillErrorKey(code)).toBe(key)
    // 服务端有时把码序列化成字符串
    expect(getSkillErrorKey(String(code))).toBe(key)
  })

  it('认不出来的码、没有码都落到 unknown', () => {
    expect(getSkillErrorKey(20999)).toBe('skills.error.unknown')
    expect(getSkillErrorKey('oops')).toBe('skills.error.unknown')
    expect(getSkillErrorKey(undefined)).toBe('skills.error.unknown')
    expect(getSkillErrorKey(null)).toBe('skills.error.unknown')
  })
})
