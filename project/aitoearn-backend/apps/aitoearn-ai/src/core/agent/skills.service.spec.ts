import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppException, ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILTIN_SKILL_NAMES, SkillInitService } from './skill-init.service'
import { SkillsService } from './skills.service'

async function expectCode(promise: Promise<unknown>, code: ResponseCode): Promise<void> {
  const error = await promise.then(() => null, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(AppException)
  expect(ResponseCode[(error as AppException).code]).toBe(ResponseCode[code])
}

/**
 * 只测不碰 `/data/skills` 的那部分：列内置技能、上传前的校验、删除前的校验。
 * 真正落盘的逻辑在 `skills-store.util.spec.ts` 里拿临时目录测。
 */
describe('skillsService', () => {
  let cwd: string
  let tmpHome: string
  let service: SkillsService

  beforeEach(() => {
    cwd = process.cwd()
    tmpHome = mkdtempSync(join(tmpdir(), 'aitoearn-skills-service-'))
    process.chdir(tmpHome)
    service = new SkillsService(new SkillInitService())
  })

  afterEach(() => {
    process.chdir(cwd)
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('内置技能全部列出，带 description 和包里的文件', () => {
    const builtin = service.listSkills().filter(skill => skill.builtin)

    expect(builtin.map(skill => skill.name)).toEqual([...BUILTIN_SKILL_NAMES].sort((a, b) => a.localeCompare(b)))
    for (const skill of builtin) {
      expect(skill.description.length, skill.name).toBeGreaterThan(0)
      expect(skill.files, skill.name).toContain('SKILL.md')
      expect(skill.files, skill.name).toEqual([...skill.files].sort())
      expect(skill.updatedAt, skill.name).toBeUndefined()
    }
  })

  it('扩展名不对，碰盘之前就拒', async () => {
    await expectCode(service.saveSkill(Buffer.from('x'), 'a.exe', false), ResponseCode.SkillFileInvalid)
  })

  it('.md 的 frontmatter 不合格，碰盘之前就拒', async () => {
    await expectCode(service.saveSkill(Buffer.from('# 没有 frontmatter'), 'a.md', false), ResponseCode.SkillFrontmatterMissing)
  })

  it('删除：名字不合规、内置、不存在各回各的码', async () => {
    await expectCode(service.deleteSkill('../etc'), ResponseCode.SkillNameInvalid)
    await expectCode(service.deleteSkill('drafting-post'), ResponseCode.SkillBuiltinReadonly)
    await expectCode(service.deleteSkill('surely-not-uploaded-e2e'), ResponseCode.SkillNotFound)
  })
})
