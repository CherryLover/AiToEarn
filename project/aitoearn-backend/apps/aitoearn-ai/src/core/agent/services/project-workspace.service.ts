import type { Stats } from 'node:fs'
import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { config } from '../../../config'
import { resolveSessionSkillsDir } from '../skill-init.service'

/**
 * 项目英文名规则（见 docs/rebuild/contract-core.md 第三节）：
 * 3~40 字符，小写字母开头，只含小写字母、数字、连字符，不以连字符结尾，且不允许连续连字符。
 *
 * 这份规则与 aitoearn-server 的 `core/projects/project-name.util.ts` 是同一份，
 * 两个应用之间没有共享代码的 lib，只能各写一份，改动时必须同步。
 */
export const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/

/** 保留字，另外任何以 `_` 或 `.` 开头的名字也一律拒绝 */
export const PROJECT_NAME_RESERVED = [
  'archived',
  'tmp',
  'temp',
  'system',
  'config',
  'node_modules',
] as const

/** 归档目录名前缀，归档后的目录一律不允许当工作目录 */
export const ARCHIVED_DIR_PREFIX = '_archived_'

/** 解析路径时最多跟随多少层软链，超过就按解析不了处理（防软链套软链 / 成环） */
const MAX_SYMLINK_HOPS = 32

/**
 * 带 projectName 的任务额外放开的内置工具。
 *
 * 刻意不含 `Bash`：命令行一旦放开，路径校验就得先解析 shell 语法才能拦住越界，
 * 可靠性无从保证；而「列目录、看文件、搜物料」用 Glob / Grep / Read 已经完全覆盖。
 */
export const PROJECT_EXTRA_TOOLS = ['Glob', 'Grep', 'Write', 'Edit'] as const

/**
 * 需要做路径校验的工具，以及它们各自的路径类入参。
 * 只列路径参数，`content` 这类内容参数不参与校验；`pattern` 另见 `TOOL_GLOB_ARGS`。
 * `NotebookEdit` 主 Agent 没开，但 polling-task 子 Agent 的工具表里有，子 Agent 同样走这个钩子。
 */
export const TOOL_PATH_ARGS: Record<string, readonly string[]> = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  Glob: ['path'],
  Grep: ['path'],
  NotebookEdit: ['notebook_path'],
}

/**
 * 通配符类入参。它们不是单个路径，没法 resolve 出一个落点来比对，
 * 但同样是相对 cwd 解析的——`Glob({ pattern: '../../**\/*' })` 有可能把项目目录外的文件名列出来。
 * 证明不了它待在笼子里就不放行：绝对路径和带 `..` 的一律拒掉。
 */
export const TOOL_GLOB_ARGS: Record<string, readonly string[]> = {
  Glob: ['pattern'],
  Grep: ['glob'],
}

/**
 * 一律不让碰的路径段。
 *
 * `settingSources` 含 `'project'`（契约要求，CLAUDE.md 要靠它自动加载），
 * SDK 会连着读 cwd 下的 `.claude/settings.json`——里面的 hooks 就是 shell 命令，
 * `.claude/skills` 里的技能也会被加载。放任用户或 Agent 往里写，等于「先不开 Bash」这个决定
 * 不用改代码就能被数据绕开。`.mcp.json` 同理。
 *
 * 所以两侧都拉黑：这里挡 Agent 自己写，aitoearn-server 的 `parseRelPath` 挡网页文件接口。
 * `CLAUDE.md` **不在**黑名单里——它就是项目说明，本来就该让项目所有者改。
 */
export const BLOCKED_PATH_SEGMENTS: readonly string[] = ['.claude', '.mcp.json']

/**
 * 会话技能目录的只读口子：只有这几个工具、只看这一个参数。
 *
 * 技能是整包装进来的（SKILL.md + references / scripts / assets），Skill 工具只把 SKILL.md 注入上下文，
 * 里面写着「细节去读 references/xxx.md」——Agent 就得自己去读。可这个目录在 `$HOME/.claude/skills`，
 * 既在项目目录外、又带 `.claude` 段，上面两条规则都会拒掉，技能包里的参考资料等于白传。
 *
 * 为什么放开是安全的：
 * - 只读。SKILL.md 本来就会被 Skill 工具整篇注入上下文，references 的用途就是给 Agent 读的，读它不多泄露什么
 * - 只限这一个目录。按**真实路径**判断（跟随软链），会话目录下的 settings、项目自己的 `.claude/` 都不在里面，照旧拒
 * - Write / Edit / NotebookEdit 不在表里，往技能目录写照旧拒：技能只能从上传接口进来
 * - Glob / Grep 的通配符参数规则不变（绝对路径和 `..` 照旧拒），要列技能目录就把它当 `path` 传
 */
export const SKILL_READ_TOOL_ARGS: Record<string, readonly string[]> = {
  Read: ['file_path'],
  Glob: ['path'],
  Grep: ['path'],
}

/**
 * 把 Agent 的工作范围焊死在单个项目的物料目录里。
 *
 * 这是三层隔离中的第三层，另外两层是：容器里只挂了 `projects`（配置和 `.env` 根本不在容器里）、
 * `cwd` 锁死在项目目录。三层都要在，任何一层都不是唯一防线。
 */
@Injectable()
export class ProjectWorkspaceService {
  private readonly logger = new Logger(ProjectWorkspaceService.name)

  /** 会话技能目录，和 SkillInitService 往里铺技能的是同一个 */
  private readonly sessionSkillsDir = resolveSessionSkillsDir()

  /** 物料根目录（容器内路径） */
  get root(): string {
    return path.resolve(config.projects.root)
  }

  /** 是否命中保留字（含以 `_` / `.` 开头的名字，归档目录名天然落在这一类里） */
  isReservedProjectName(name: string): boolean {
    const lower = name.toLowerCase()
    if (lower.startsWith('_') || lower.startsWith('.'))
      return true

    if (lower.startsWith(ARCHIVED_DIR_PREFIX))
      return true

    return (PROJECT_NAME_RESERVED as readonly string[]).includes(lower)
  }

  /** 是否符合命名正则（含连续连字符检查） */
  isValidProjectName(name: string): boolean {
    if (!PROJECT_NAME_PATTERN.test(name))
      return false

    return !name.includes('--')
  }

  /**
   * 校验调用方传来的项目英文名，不合法直接抛业务异常。
   * 先判保留字再判正则：`node_modules`、`_archived_foo_20260918` 这类既命中保留字又不符合正则，
   * 给出更准确的提示。
   */
  assertProjectNameUsable(name: string): void {
    if (this.isReservedProjectName(name))
      throw new AppException(ResponseCode.ProjectNameReserved)

    if (!this.isValidProjectName(name))
      throw new AppException(ResponseCode.ProjectNameInvalid)
  }

  /**
   * 解析出项目物料目录，作为 Agent 的工作目录。
   *
   * 名字自己校验，不信调用方；目录必须已经存在（由 aitoearn-server 建），这里绝不自己建。
   */
  resolveProjectCwd(projectName: string): string {
    this.assertProjectNameUsable(projectName)

    const projectDir = this.resolveInsideRoot(projectName)

    const stats = this.statOrNull(projectDir)
    if (!stats?.isDirectory()) {
      this.logger.warn(`项目物料目录不存在或不是目录: ${projectDir}`)
      throw new AppException(ResponseCode.ProjectNotFound)
    }

    return projectDir
  }

  /**
   * 校验一个工具入参里的路径是否落在项目目录内，越界抛 `ProjectPathEscape`。
   * 相对路径按工作目录（即项目目录）解析，和 Agent 自己看到的行为一致。
   */
  assertPathInsideProject(projectDir: string, candidate: string): void {
    const resolved = path.resolve(projectDir, candidate)
    this.assertInsideBase(projectDir, resolved)
    this.assertNotAgentConfig(projectDir, resolved)

    const realDir = this.toRealPath(projectDir)
    const realResolved = this.toRealPath(resolved)
    this.assertInsideBase(realDir, realResolved)
    // 软链指向 `.claude` 的话，词法路径上看不出来，得拿真实落点再查一遍
    this.assertNotAgentConfig(realDir, realResolved)
  }

  /** 落在项目里还不够，Agent 自己的配置目录同样不许碰（见 `BLOCKED_PATH_SEGMENTS`） */
  private assertNotAgentConfig(projectDir: string, resolved: string): void {
    const rel = path.relative(projectDir, resolved)
    if (rel.length === 0)
      return

    for (const segment of rel.split(path.sep)) {
      if (BLOCKED_PATH_SEGMENTS.includes(segment.toLowerCase()))
        throw new AppException(ResponseCode.ProjectFilePathInvalid)
    }
  }

  /**
   * 是不是对会话技能目录的只读访问（见 `SKILL_READ_TOOL_ARGS`）。
   *
   * 按**真实路径**判断，落在技能目录里（含技能目录本身）才算：
   * `<技能目录>/../settings.json` 真实落点是会话配置；技能目录里一个指向外面的软链，真实落点在外面——都不算。
   * 不存在的路径 `toRealPath` 拿最近一层真实存在的祖先去解析、剩下的部分按词法拼回去；解析不了的一律不算。
   *
   * 技能目录本身必须是真目录：它要是被换成了软链（比如指向 `/`），这个口子就等于全开，宁可整个关掉。
   */
  isReadOnlySkillAccess(projectDir: string, toolName: string, argName: string, candidate: string): boolean {
    if (!(SKILL_READ_TOOL_ARGS[toolName] ?? []).includes(argName))
      return false

    const skillsDir = path.resolve(this.sessionSkillsDir)
    if (!this.isRealDirectory(skillsDir))
      return false

    try {
      const realSkillsDir = this.toRealPath(skillsDir)
      const realResolved = this.toRealPath(path.resolve(projectDir, candidate))
      return this.isInsideOrSame(realSkillsDir, realResolved)
    }
    catch {
      return false
    }
  }

  private isRealDirectory(target: string): boolean {
    try {
      return lstatSync(target).isDirectory()
    }
    catch {
      return false
    }
  }

  private isInsideOrSame(base: string, target: string): boolean {
    return target === base || target.startsWith(base + path.sep)
  }

  /** 通配符不能是绝对路径，也不能带 `..`：证明不了它只匹配项目目录里的东西就不放行 */
  isGlobPatternInsideProject(pattern: string): boolean {
    if (pattern.length === 0)
      return false

    if (pattern.startsWith('/') || pattern.startsWith('~') || path.isAbsolute(pattern))
      return false

    return !pattern.split(/[/\\]+/).includes('..')
  }

  /**
   * canUseTool 钩子用：检查一次工具调用的全部路径类入参。
   * 通过返回 null，不通过返回给模型看的拒绝原因——要让它知道是越界，不是文件不存在。
   */
  checkToolInput(projectDir: string, toolName: string, input: Record<string, unknown>): string | null {
    const pathArgs = TOOL_PATH_ARGS[toolName] ?? []
    const globArgs = TOOL_GLOB_ARGS[toolName] ?? []
    if (pathArgs.length === 0 && globArgs.length === 0)
      return null

    for (const argName of pathArgs) {
      const value = input[argName]
      if (value === undefined || value === null)
        continue

      if (typeof value !== 'string') {
        return this.buildDenyMessage(projectDir, argName, String(value), 'it is not a path string')
      }

      if (this.isReadOnlySkillAccess(projectDir, toolName, argName, value))
        continue

      try {
        this.assertPathInsideProject(projectDir, value)
      }
      catch (error) {
        this.logger.warn(
          `工具 ${toolName} 的 ${argName} 越界，已拒绝: ${value}`,
          error instanceof Error ? error.stack : String(error),
        )

        const reason = error instanceof AppException && error.code === ResponseCode.ProjectFilePathInvalid
          ? 'it points at the agent configuration (`.claude` / `.mcp.json`), which tasks are never allowed to read or write'
          : 'it resolves outside the project workspace'

        return this.buildDenyMessage(projectDir, argName, value, reason)
      }
    }

    for (const argName of globArgs) {
      const value = input[argName]
      if (value === undefined || value === null)
        continue

      if (typeof value !== 'string') {
        return this.buildDenyMessage(projectDir, argName, String(value), 'it is not a glob string')
      }

      if (!this.isGlobPatternInsideProject(value)) {
        this.logger.warn(`工具 ${toolName} 的 ${argName} 可能匹配到项目外，已拒绝: ${value}`)
        return this.buildDenyMessage(
          projectDir,
          argName,
          value,
          'a glob may not be absolute and may not contain `..`; it is always matched from the project workspace root',
        )
      }
    }

    return null
  }

  /** 解析根目录下的路径，并确保它没有跑出根目录 */
  private resolveInsideRoot(...segments: string[]): string {
    const root = this.root
    const resolved = path.resolve(root, ...segments)
    this.assertInsideBase(root, resolved)
    this.assertInsideBase(this.toRealPath(root), this.toRealPath(resolved))

    return resolved
  }

  private assertInsideBase(base: string, target: string): void {
    if (!this.isInsideOrSame(base, target))
      throw new AppException(ResponseCode.ProjectPathEscape)
  }

  /** 跟随软链取状态；不存在、悬空软链、读不到都返回 null（交给调用方按「项目不存在」处理） */
  private statOrNull(target: string): Stats | null {
    try {
      return statSync(target)
    }
    catch {
      return null
    }
  }

  /**
   * 求路径的真实位置：一级级往上找到第一个真实存在的祖先做 realpath，
   * 再把剩下还没建出来的部分拼回去。这样目录还不存在时也能判断它将来会落在哪。
   *
   * 关键点：realpath 读不到 ≠ 这个路径不存在。指向项目目录外、且目标文件还没建出来的
   * 软链（悬空软链）同样报 ENOENT，但 lstat 能看见软链本身，写入时系统会顺着它跑出去。
   * 所以把 ENOENT 当成「尚未创建」之前，必须先确认这一段真的不存在。
   *
   * 与 aitoearn-server 的 `ProjectDirService#toRealPath` 同源，只是换成同步调用：
   * claudeQuery 是同步组装 options 的，这里不引入 async 以免改到不带 projectName 的老链路。
   */
  private toRealPath(target: string): string {
    const pending: string[] = []
    let current = target
    let hops = 0

    for (;;) {
      try {
        const real = realpathSync(current)
        return pending.length > 0 ? path.join(real, ...pending) : real
      }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // 只有「还不存在」才继续往上找；其它错误（含软链成环的 ELOOP）说明这条路径没法证明是安全的，按越界处理
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          this.logger.error(`解析真实路径失败: ${current}`, error instanceof Error ? error.stack : String(error))
          throw new AppException(ResponseCode.ProjectPathEscape)
        }

        // 这一段其实是个悬空软链的话，接着解析它指向哪，不能当成「将来会建在项目目录里」
        const linkTarget = this.readSymlinkTarget(current)
        if (linkTarget !== null) {
          if (++hops > MAX_SYMLINK_HOPS) {
            this.logger.error(`软链层数过多，拒绝解析: ${target}`)
            throw new AppException(ResponseCode.ProjectPathEscape)
          }

          current = linkTarget
          continue
        }

        const parent = path.dirname(current)
        if (parent === current) {
          this.logger.error(`无法确定路径的真实位置: ${target}`)
          throw new AppException(ResponseCode.ProjectPathEscape)
        }

        pending.unshift(path.basename(current))
        current = parent
      }
    }
  }

  /**
   * 这一段是软链就返回它指向的绝对路径（相对软链相对于它所在目录解析）；
   * 确实不存在返回 null；存在却判断不了的一律拒绝（fail closed）。
   */
  private readSymlinkTarget(current: string): string | null {
    try {
      const stats = lstatSync(current)
      if (!stats.isSymbolicLink()) {
        this.logger.error(`路径存在但无法解析真实位置: ${current}`)
        throw new AppException(ResponseCode.ProjectPathEscape)
      }

      const link = readlinkSync(current)
      return path.resolve(path.dirname(current), link)
    }
    catch (error) {
      if (error instanceof AppException)
        throw error

      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR')
        return null

      this.logger.error(`读取软链失败: ${current}`, error instanceof Error ? error.stack : String(error))
      throw new AppException(ResponseCode.ProjectPathEscape)
    }
  }

  private buildDenyMessage(projectDir: string, argName: string, value: string, reason: string): string {
    return `Permission denied: \`${argName}\` = "${value}" was rejected because ${reason}. `
      + `This task is locked to the project workspace \`${projectDir}\` and every path must stay inside it. `
      + `This is NOT a "file not found" error — the path may well exist, you are simply not allowed to touch anything outside the project. `
      + `The only exception is read-only access (Read, or Glob / Grep with \`path\` set to it) to installed skill files under \`${this.sessionSkillsDir}\`; `
      + `writing there is never allowed. `
      + `Retry with a path inside the project workspace.`
  }
}
