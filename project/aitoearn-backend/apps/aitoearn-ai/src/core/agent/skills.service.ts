/**
 * 自定义技能：列、传、删
 *
 * 存的是文件不是记录——技能就是一个目录（入口 SKILL.md，外加 references / scripts 等），
 * Agent 运行时按文件读。塞进数据库意味着每次跑之前要先捞出来写成文件，凭空多一层，
 * 还多一个「库里有、盘上没有」的失配状态。见 `docs/rebuild/contract-custom-skills.md`。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Injectable } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import {
  BUILTIN_SKILL_NAMES,
  CUSTOM_SKILLS_DIR,
  listCustomSkillNames,
  SKILL_FILE_NAME,
  SkillInitService,
} from './skill-init.service'
import { listFilesRecursive } from './skills-fs.util'
import { MAX_LISTED_SKILL_FILES, removeStoredSkill, storeSkillUpload } from './skills-store.util'
import {
  isBuiltinSkillName,
  isValidSkillName,
  readSkillFrontmatter,
  SkillSummary,
} from './skills.util'

@Injectable()
export class SkillsService {
  private readonly builtinDir = path.join(__dirname, 'skills')

  constructor(private readonly skillInit: SkillInitService) {}

  /** 内置的和用户传的一起返回，各自标明来源 */
  listSkills(): SkillSummary[] {
    return [...this.listBuiltin(), ...this.listCustom()]
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private listBuiltin(): SkillSummary[] {
    return BUILTIN_SKILL_NAMES.map((name) => {
      const dir = path.join(this.builtinDir, name)
      return {
        name,
        description: this.readDescription(path.join(dir, SKILL_FILE_NAME)),
        builtin: true,
        files: listFilesRecursive(dir, MAX_LISTED_SKILL_FILES),
      }
    })
  }

  private listCustom(): SkillSummary[] {
    // 读不了目录就当没有：列表少几行，总好过整个接口挂掉（同步那边会打错误日志）
    let names: string[]
    try {
      names = listCustomSkillNames(CUSTOM_SKILLS_DIR)
    }
    catch {
      return []
    }

    // 内置同名的不列：它在磁盘上可能还躺着，但同步时会被内置的盖住，列出来只会让人以为它生效了
    return names
      .filter(name => !isBuiltinSkillName(name))
      .map((name) => {
        const dir = path.join(CUSTOM_SKILLS_DIR, name)
        const file = path.join(dir, SKILL_FILE_NAME)
        return {
          name,
          description: this.readDescription(file),
          builtin: false,
          updatedAt: this.readModifiedAt(file),
          files: listFilesRecursive(dir, MAX_LISTED_SKILL_FILES),
        }
      })
  }

  /**
   * 读不出来就给空串：列表少一句说明，总好过整个接口挂掉。
   * 只读不校验：内置技能的名字本来就过不了上传校验（和内置重名），拿 `parseSkillFile` 读会把它们的说明全读成空。
   */
  private readDescription(file: string): string {
    try {
      return readSkillFrontmatter(fs.readFileSync(file, 'utf-8'))?.description ?? ''
    }
    catch {
      return ''
    }
  }

  private readModifiedAt(file: string): Date | undefined {
    try {
      return fs.statSync(file).mtime
    }
    catch {
      return undefined
    }
  }

  /**
   * 收一个技能：单个 `.md`，或者标准技能包 `.zip`（SKILL.md + references / scripts / assets …）。
   * 校验和原子落盘见 `storeSkillUpload`；落完立刻同步进 Agent 读的目录，不用重启，下一轮对话就能用。
   */
  async saveSkill(buffer: Buffer, originalName: string, overwrite: boolean): Promise<SkillSummary> {
    const stored = await storeSkillUpload(CUSTOM_SKILLS_DIR, { buffer, originalName }, overwrite)

    this.skillInit.syncSkills()

    return {
      name: stored.name,
      description: stored.description,
      builtin: false,
      updatedAt: new Date(),
      files: stored.files,
    }
  }

  /** 删用户目录里的那份；Agent 读的那份交给同步去清（不在用户目录里的一律删掉） */
  async deleteSkill(name: string): Promise<void> {
    if (!isValidSkillName(name))
      throw new AppException(ResponseCode.SkillNameInvalid)

    if (isBuiltinSkillName(name))
      throw new AppException(ResponseCode.SkillBuiltinReadonly)

    if (!(await removeStoredSkill(CUSTOM_SKILLS_DIR, name)))
      throw new AppException(ResponseCode.SkillNotFound)

    this.skillInit.syncSkills()
  }
}
