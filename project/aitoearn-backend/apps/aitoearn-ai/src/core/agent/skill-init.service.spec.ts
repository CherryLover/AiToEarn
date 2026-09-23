import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_SKILL_NAMES,
  listCustomSkillNames,
  resolveSessionSkillsDir,
  SkillInitService,
  SkillSyncPaths,
  syncSkillDirectories,
} from './skill-init.service'

const SKILLS_DIR = join(__dirname, 'skills')

function listSkillDirs(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter(name => statSync(join(SKILLS_DIR, name)).isDirectory())
    .sort()
}

function readFrontMatter(skillName: string): Record<string, string> {
  const text = readFileSync(join(SKILLS_DIR, skillName, 'SKILL.md'), 'utf8')
  const matched = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!matched)
    return {}

  const fields: Record<string, string> = {}
  for (const line of matched[1].split('\n')) {
    const field = /^(\w+): ?(\S.*)$/.exec(line)
    if (field)
      fields[field[1]] = field[2]
  }

  return fields
}

function writeFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function listTree(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listTree(join(dir, entry.name), rel) : [rel]
  }).sort()
}

describe('skillInitService', () => {
  let cwd: string
  let tmpHome: string

  beforeEach(() => {
    cwd = process.cwd()
    tmpHome = mkdtempSync(join(tmpdir(), 'aitoearn-skill-init-'))
    process.chdir(tmpHome)
  })

  afterEach(() => {
    process.chdir(cwd)
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('把技能目录全部拷进会话目录', async () => {
    await new SkillInitService().onModuleInit()

    const target = join(tmpHome, '.claude-session', '.claude', 'skills')
    expect(readdirSync(target).sort()).toEqual(listSkillDirs())

    for (const skillName of listSkillDirs())
      expect(existsSync(join(target, skillName, 'SKILL.md')), skillName).toBe(true)
  })

  it('会话技能目录跟着 cwd 走（HOME = <cwd>/.claude-session）', () => {
    expect(resolveSessionSkillsDir()).toBe(join(process.cwd(), '.claude-session', '.claude', 'skills'))
  })

  it('每个技能都有 SKILL.md，且 name 与目录名一致', () => {
    for (const skillName of listSkillDirs()) {
      const fields = readFrontMatter(skillName)
      expect(fields.name, skillName).toBe(skillName)
      expect(fields.description?.length ?? 0, skillName).toBeGreaterThan(0)
    }
  })
})

describe('syncSkillDirectories 同步', () => {
  const logger = new Logger('SkillSyncSpec')
  let sandbox: string
  let paths: SkillSyncPaths

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'aitoearn-skill-sync-'))
    paths = {
      builtinDir: join(sandbox, 'builtin'),
      customDir: join(sandbox, 'custom'),
      targetDir: join(sandbox, 'session', '.claude', 'skills'),
    }

    for (const name of BUILTIN_SKILL_NAMES)
      writeFile(join(paths.builtinDir, name, 'SKILL.md'), `builtin ${name}`)
    writeFile(join(paths.builtinDir, 'drafting-post', 'references', 'style.md'), 'builtin reference')
  })

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true })
  })

  it('整目录递归复制，内置和自定义都带上子目录，scripts 的执行权限不丢', () => {
    writeFile(join(paths.customDir, 'my-skill', 'SKILL.md'), 'custom')
    writeFile(join(paths.customDir, 'my-skill', 'references', 'deep', 'api.md'), 'api')
    writeFile(join(paths.customDir, 'my-skill', 'scripts', 'run.sh'), 'echo hi')
    chmodSync(join(paths.customDir, 'my-skill', 'scripts', 'run.sh'), 0o755)

    syncSkillDirectories(paths, logger)

    expect(listTree(join(paths.targetDir, 'my-skill'))).toEqual(['SKILL.md', 'references/deep/api.md', 'scripts/run.sh'])
    expect(statSync(join(paths.targetDir, 'my-skill', 'scripts', 'run.sh')).mode & 0o777).toBe(0o755)
    expect(readFileSync(join(paths.targetDir, 'drafting-post', 'references', 'style.md'), 'utf8')).toBe('builtin reference')
  })

  it('覆盖后再同步，旧包里多出来的文件不残留', () => {
    writeFile(join(paths.customDir, 'my-skill', 'SKILL.md'), 'v1')
    writeFile(join(paths.customDir, 'my-skill', 'references', 'old.md'), 'old')
    syncSkillDirectories(paths, logger)

    rmSync(join(paths.customDir, 'my-skill'), { recursive: true })
    writeFile(join(paths.customDir, 'my-skill', 'SKILL.md'), 'v2')
    syncSkillDirectories(paths, logger)

    expect(listTree(join(paths.targetDir, 'my-skill'))).toEqual(['SKILL.md'])
    expect(readFileSync(join(paths.targetDir, 'my-skill', 'SKILL.md'), 'utf8')).toBe('v2')
  })

  it('删掉的自定义技能同步后从会话目录消失，其他来路不明的条目也清掉', () => {
    writeFile(join(paths.customDir, 'my-skill', 'SKILL.md'), 'custom')
    syncSkillDirectories(paths, logger)
    writeFile(join(paths.targetDir, 'stray', 'SKILL.md'), 'nobody owns me')

    rmSync(join(paths.customDir, 'my-skill'), { recursive: true })
    syncSkillDirectories(paths, logger)

    expect(readdirSync(paths.targetDir).sort()).toEqual([...BUILTIN_SKILL_NAMES].sort())
  })

  it('内置的赢：用户目录里和内置同名的不复制', () => {
    writeFile(join(paths.customDir, 'drafting-post', 'SKILL.md'), 'impostor')
    syncSkillDirectories(paths, logger)

    expect(readFileSync(join(paths.targetDir, 'drafting-post', 'SKILL.md'), 'utf8')).toBe('builtin drafting-post')
  })

  it('以 . 开头的临时目录、没有 SKILL.md 的目录都不算技能', () => {
    writeFile(join(paths.customDir, '.tmp-abc', 'SKILL.md'), 'half extracted')
    writeFile(join(paths.customDir, '.trash-abc', 'SKILL.md'), 'being deleted')
    writeFile(join(paths.customDir, 'empty-shell', 'notes.md'), 'no entry')

    syncSkillDirectories(paths, logger)

    expect(readdirSync(paths.targetDir).sort()).toEqual([...BUILTIN_SKILL_NAMES].sort())
    expect(listCustomSkillNames(paths.customDir)).toEqual([])
  })

  it('软链不跟：技能目录本身是软链、技能里有软链，都不复制', () => {
    writeFile(join(sandbox, 'outside', 'SKILL.md'), 'outside')
    writeFile(join(sandbox, 'outside', 'secret.txt'), 'secret')
    writeFile(join(paths.customDir, 'my-skill', 'SKILL.md'), 'custom')
    symlinkSync(join(sandbox, 'outside'), join(paths.customDir, 'linked-skill'), 'dir')
    symlinkSync(join(sandbox, 'outside', 'secret.txt'), join(paths.customDir, 'my-skill', 'leak.txt'), 'file')

    syncSkillDirectories(paths, logger)

    expect(existsSync(join(paths.targetDir, 'linked-skill'))).toBe(false)
    expect(listTree(join(paths.targetDir, 'my-skill'))).toEqual(['SKILL.md'])
  })

  it('用户目录不存在（本地跑）不算错，只铺内置的', () => {
    syncSkillDirectories(paths, logger)
    expect(readdirSync(paths.targetDir).sort()).toEqual([...BUILTIN_SKILL_NAMES].sort())
  })

  it('用户目录读不了时不清理：宁可留着旧的，也不一次撤掉所有用户技能', () => {
    writeFile(join(paths.customDir, 'my-skill', 'SKILL.md'), 'custom')
    syncSkillDirectories(paths, logger)

    rmSync(paths.customDir, { recursive: true })
    writeFileSync(paths.customDir, 'not a directory')
    syncSkillDirectories(paths, logger)

    expect(existsSync(join(paths.targetDir, 'my-skill', 'SKILL.md'))).toBe(true)
  })
})
