import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillInitService } from './skill-init.service'

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

  it('每个技能都有 SKILL.md，且 name 与目录名一致', () => {
    for (const skillName of listSkillDirs()) {
      const fields = readFrontMatter(skillName)
      expect(fields.name, skillName).toBe(skillName)
      expect(fields.description?.length ?? 0, skillName).toBeGreaterThan(0)
    }
  })
})
