import * as fs from 'node:fs'
import * as path from 'node:path'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  copyDirectoryRecursive,
  isHiddenEntryName,
  isRealDirectory,
  isRegularFile,
} from './skills-fs.util'

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

/** 技能的入口文件，在技能根目录下；references / scripts 等子目录随意 */
export const SKILL_FILE_NAME = 'SKILL.md'

/**
 * 会话技能目录：Agent 真正读技能的地方，即 `$HOME/.claude/skills`，
 * 而 `AgentRuntimeService` 把 HOME 设成了 `<cwd>/.claude-session`。
 *
 * 同步往这里铺，`ProjectWorkspaceService` 在项目对话里也只对这个目录开只读口子，两边必须是同一个路径。
 * 做成函数不做常量：cwd 要在用的那一刻取，测试才能把它换到临时目录。
 */
export function resolveSessionSkillsDir(): string {
  return path.join(process.cwd(), '.claude-session', '.claude', 'skills')
}

function isBuiltinName(name: string): boolean {
  return (BUILTIN_SKILL_NAMES as readonly string[]).includes(name)
}

/**
 * 用户技能目录里看起来像技能的目录名：真实目录（不跟软链）、不以 `.` 开头、根下有 `SKILL.md`。
 * **不排除和内置重名的**，由调用方决定怎么处理（同步要打警告，列表直接跳过）。
 * 目录不存在返回空数组（本地跑的时候就没有这个挂载）；其他读错误照常抛出。
 */
export function listCustomSkillNames(customDir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(customDir, { withFileTypes: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw error
  }

  return entries
    .filter(entry => entry.isDirectory() && !isHiddenEntryName(entry.name))
    .filter(entry => isRegularFile(path.join(customDir, entry.name, SKILL_FILE_NAME)))
    .map(entry => entry.name)
    .sort()
}

export interface SkillSyncPaths {
  /** 镜像里的内置技能 */
  builtinDir: string
  /** 用户传的技能（`/data/skills`） */
  customDir: string
  /** 会话技能目录，Agent 从这里读 */
  targetDir: string
}

/**
 * 把内置技能和用户技能都整目录摊进会话技能目录。
 *
 * - 每个技能**整目录递归复制**（references / scripts / assets 都要带上），复制前先删掉目标里的同名目录，
 *   否则覆盖上传后旧包里多出来的文件会一直残留
 * - 内置的先铺，用户的后铺，用户的不许盖掉内置的（见 `BUILTIN_SKILL_NAMES` 的注释）
 * - 铺完把目标里**既不是内置、也不在用户目录里**的条目删掉：删掉的技能不能还被 Agent 读到
 * - 用户目录读不了（不是不存在）时不做清理：宁可留着旧的，也不能因为一次读失败把所有用户技能从 Agent 那撤掉
 */
export function syncSkillDirectories(paths: SkillSyncPaths, logger: Logger): void {
  fs.mkdirSync(paths.targetDir, { recursive: true })

  for (const skillName of BUILTIN_SKILL_NAMES)
    replaceSkillDirectory(paths.builtinDir, skillName, paths.targetDir, logger)

  let customNames: string[]
  try {
    customNames = listCustomSkillNames(paths.customDir)
  }
  catch (error) {
    logger.error(error as Error, `Failed to read custom skills dir ${paths.customDir}`)
    return
  }

  for (const skillName of customNames) {
    if (isBuiltinName(skillName)) {
      logger.warn(`Custom skill shadows a built-in one, skipped: ${skillName}`)
      continue
    }

    replaceSkillDirectory(paths.customDir, skillName, paths.targetDir, logger)
  }

  pruneSessionSkills(paths.targetDir, new Set<string>([...BUILTIN_SKILL_NAMES, ...customNames]), logger)
}

/** 一个技能复制失败不拖累其他技能 */
function replaceSkillDirectory(sourceRoot: string, skillName: string, targetDir: string, logger: Logger): void {
  const src = path.join(sourceRoot, skillName)
  const dest = path.join(targetDir, skillName)

  if (!isRealDirectory(src)) {
    logger.warn(`Skill not found: ${skillName}`)
    return
  }

  try {
    fs.rmSync(dest, { recursive: true, force: true })
    copyDirectoryRecursive(src, dest)
  }
  catch (error) {
    logger.error(error as Error, `Failed to copy skill ${skillName}`)
  }
}

function pruneSessionSkills(targetDir: string, keep: ReadonlySet<string>, logger: Logger): void {
  for (const name of fs.readdirSync(targetDir)) {
    if (keep.has(name))
      continue

    try {
      fs.rmSync(path.join(targetDir, name), { recursive: true, force: true })
    }
    catch (error) {
      logger.error(error as Error, `Failed to remove stale skill ${name}`)
    }
  }
}

@Injectable()
export class SkillInitService implements OnModuleInit {
  private readonly logger = new Logger(SkillInitService.name)
  private readonly paths: SkillSyncPaths = {
    builtinDir: path.join(__dirname, 'skills'),
    customDir: CUSTOM_SKILLS_DIR,
    targetDir: resolveSessionSkillsDir(),
  }

  async onModuleInit(): Promise<void> {
    try {
      this.syncSkills()
      this.logger.log(`Skills initialized: ${this.paths.targetDir}`)
    }
    catch (error) {
      this.logger.error(error as Error, 'Failed to initialize skills')
    }
  }

  /**
   * 上传或删除之后要立刻再跑一次，这样不重启服务，下一轮对话就能用上。
   * 规则见 `syncSkillDirectories`。
   */
  syncSkills(): void {
    syncSkillDirectories(this.paths, this.logger)
  }
}
