import * as fs from 'node:fs'
import * as path from 'node:path'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

/**
 * 镜像里自带的技能。**用户传上来的不许和这些重名**——
 * 重名在上传那关就挡掉，同步时再挡一次是兜底：镜像升级加了新内置技能、
 * 恰好和某个已存在的用户技能同名时，内置的必须赢，
 * 否则一次升级会被一个旧文件悄悄改掉行为。
 */
export const BUILTIN_SKILL_NAMES = [
  'generating-images',
  'generating-videos',
  'editing-videos',
  'editing-images',
  'transferring-video-styles',
  'generating-drama-recaps',
  'composing-videos',
  'translating-videos',
  'removing-subtitles',
  'analyzing-videos',
  'managing-content',
  'crawling-social-media',
  'extracting-thumbnails',
  'extracting-angles',
  'drafting-post',
] as const

/**
 * 用户传上来的技能落在哪。挂载进来的目录，不在容器里——
 * 容器每次部署都被删掉重建，写在容器里的东西一律丢失。
 */
export const CUSTOM_SKILLS_DIR = '/data/skills'

/** 一个技能就是一个目录，里面这一个文件 */
export const SKILL_FILE_NAME = 'SKILL.md'

@Injectable()
export class SkillInitService implements OnModuleInit {
  private readonly logger = new Logger(SkillInitService.name)
  private readonly sourceDir = path.join(__dirname, 'skills')
  private readonly targetDir = path.join(process.cwd(), '.claude-session', '.claude', 'skills')

  async onModuleInit(): Promise<void> {
    try {
      this.syncSkills()
      this.logger.log(`Skills initialized: ${this.targetDir}`)
    }
    catch (error) {
      this.logger.error('Failed to initialize skills', error)
    }
  }

  /**
   * 把内置技能和用户技能都摊进 Agent 读的那个目录。
   *
   * 上传或删除之后要立刻再跑一次，这样不重启服务，下一轮对话就能用上。
   * 顺序有讲究：内置的先铺，用户的后铺，但用户的不许盖掉内置的（见 BUILTIN_SKILL_NAMES 的注释）。
   */
  syncSkills(): void {
    fs.mkdirSync(this.targetDir, { recursive: true })

    for (const skillName of BUILTIN_SKILL_NAMES) {
      this.copySkillDirectory(this.sourceDir, skillName)
    }

    this.copyCustomSkills()
  }

  /** 用户技能目录没挂上不是错：这套东西在本地跑的时候就没有这个挂载 */
  private copyCustomSkills(): void {
    if (!fs.existsSync(CUSTOM_SKILLS_DIR)) {
      this.logger.debug(`Custom skills dir absent, skipped: ${CUSTOM_SKILLS_DIR}`)
      return
    }

    let entries: string[]
    try {
      entries = fs.readdirSync(CUSTOM_SKILLS_DIR)
    }
    catch (error) {
      this.logger.error(error as Error, 'Failed to read custom skills dir')
      return
    }

    for (const name of entries) {
      if ((BUILTIN_SKILL_NAMES as readonly string[]).includes(name)) {
        this.logger.warn(`Custom skill shadows a built-in one, skipped: ${name}`)
        continue
      }

      if (!fs.existsSync(path.join(CUSTOM_SKILLS_DIR, name, SKILL_FILE_NAME)))
        continue

      this.copySkillDirectory(CUSTOM_SKILLS_DIR, name)
    }
  }

  private copySkillDirectory(sourceDir: string, skillName: string): void {
    const src = path.join(sourceDir, skillName)
    const dest = path.join(this.targetDir, skillName)

    if (!fs.existsSync(src)) {
      this.logger.warn(`Skill not found: ${skillName}`)
      return
    }

    fs.mkdirSync(dest, { recursive: true })

    for (const file of fs.readdirSync(src)) {
      const srcFile = path.join(src, file)
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, path.join(dest, file))
      }
    }
  }
}
