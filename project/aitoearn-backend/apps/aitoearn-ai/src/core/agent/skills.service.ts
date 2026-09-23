/**
 * 自定义技能：列、传、删
 *
 * 存的是文件不是记录——技能的内容就是一份 Markdown，Agent 运行时按文件读。
 * 塞进数据库意味着每次跑之前要先捞出来写成文件，凭空多一层，
 * 还多一个「库里有、盘上没有」的失配状态。见 `docs/rebuild/contract-custom-skills.md`。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import {
  BUILTIN_SKILL_NAMES,
  CUSTOM_SKILLS_DIR,
  SKILL_FILE_NAME,
  SkillInitService,
} from './skill-init.service'
import {
  isBuiltinSkillName,
  isValidSkillName,
  MAX_SKILL_FILE_BYTES,
  parseSkillFile,
  SkillSummary,
} from './skills.util'

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name)
  private readonly builtinDir = path.join(__dirname, 'skills')

  constructor(private readonly skillInit: SkillInitService) {}

  /** 内置的和用户传的一起返回，各自标明来源 */
  listSkills(): SkillSummary[] {
    return [...this.listBuiltin(), ...this.listCustom()]
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private listBuiltin(): SkillSummary[] {
    return BUILTIN_SKILL_NAMES.map((name) => {
      const file = path.join(this.builtinDir, name, SKILL_FILE_NAME)
      return {
        name,
        description: this.readDescription(file),
        builtin: true,
      }
    })
  }

  private listCustom(): SkillSummary[] {
    if (!fs.existsSync(CUSTOM_SKILLS_DIR))
      return []

    const result: SkillSummary[] = []
    for (const name of fs.readdirSync(CUSTOM_SKILLS_DIR)) {
      // 内置同名的不列：它在磁盘上可能还躺着，但同步时会被内置的盖住，列出来只会让人以为它生效了
      if (isBuiltinSkillName(name))
        continue

      const file = path.join(CUSTOM_SKILLS_DIR, name, SKILL_FILE_NAME)
      if (!fs.existsSync(file))
        continue

      result.push({
        name,
        description: this.readDescription(file),
        builtin: false,
        updatedAt: fs.statSync(file).mtime,
      })
    }
    return result
  }

  /** 读不出来就给空串：列表少一句说明，总好过整个接口挂掉 */
  private readDescription(file: string): string {
    try {
      const parsed = parseSkillFile(fs.readFileSync(file, 'utf-8'))
      return parsed.ok ? parsed.meta.description : ''
    }
    catch {
      return ''
    }
  }

  /**
   * 收一个技能。
   *
   * 落盘路径拿**校验过的 name** 重新拼，绝不用上传来的文件名——
   * 这是挡路径穿越的那一道，别图省事改掉。
   */
  saveSkill(buffer: Buffer, originalName: string, overwrite: boolean): SkillSummary {
    if (buffer.byteLength > MAX_SKILL_FILE_BYTES)
      throw new AppException(ResponseCode.SkillFileTooLarge)

    if (!originalName.toLowerCase().endsWith('.md'))
      throw new AppException(ResponseCode.SkillFileInvalid)

    const content = buffer.toString('utf-8')
    const parsed = parseSkillFile(content)
    if (!parsed.ok) {
      if (parsed.reason === 'name_invalid')
        throw new AppException(ResponseCode.SkillNameInvalid)
      if (parsed.reason === 'name_reserved')
        throw new AppException(ResponseCode.SkillNameReserved)
      throw new AppException(ResponseCode.SkillFrontmatterMissing)
    }

    const { name, description } = parsed.meta
    const dir = path.join(CUSTOM_SKILLS_DIR, name)
    const file = path.join(dir, SKILL_FILE_NAME)

    if (!overwrite && fs.existsSync(file))
      throw new AppException(ResponseCode.SkillAlreadyExists)

    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(file, content, 'utf-8')
    }
    catch (error) {
      this.logger.error(error as Error, `Failed to write skill ${name}`)
      throw new AppException(ResponseCode.SkillStorageUnavailable)
    }

    // 立刻摊进 Agent 读的目录，不用重启，下一轮对话就能用
    this.skillInit.syncSkills()

    return { name, description, builtin: false, updatedAt: new Date() }
  }

  deleteSkill(name: string): void {
    if (!isValidSkillName(name))
      throw new AppException(ResponseCode.SkillNameInvalid)

    if (isBuiltinSkillName(name))
      throw new AppException(ResponseCode.SkillBuiltinReadonly)

    const dir = path.join(CUSTOM_SKILLS_DIR, name)
    if (!fs.existsSync(dir))
      throw new AppException(ResponseCode.SkillNotFound)

    try {
      fs.rmSync(dir, { recursive: true, force: true })
      // Agent 读的那份也要撤掉，否则删了还能用
      fs.rmSync(path.join(process.cwd(), '.claude-session', '.claude', 'skills', name), {
        recursive: true,
        force: true,
      })
    }
    catch (error) {
      this.logger.error(error as Error, `Failed to delete skill ${name}`)
      throw new AppException(ResponseCode.SkillStorageUnavailable)
    }

    this.skillInit.syncSkills()
  }
}
