import { lstat, mkdir, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { config } from '../../config'

/** 项目物料目录里需要预先建出来的空目录，各放一个 .gitkeep 保证目录真实存在 */
const PROJECT_SUB_DIRS = [
  'background/product',
  'background/website',
  'background/feedback',
  'background/legal',
  'angles',
  'drafts',
  'media',
] as const

const EMPTY_FIELD_PLACEHOLDER = '（未填写）'

/** 解析路径时最多跟随多少层软链，超过就按解析不了处理（防软链套软链 / 成环） */
const MAX_SYMLINK_HOPS = 32

export interface ProjectDirInfo {
  name: string
  displayName: string
  desc?: string | null
  audience?: string | null
  goal?: string | null
}

@Injectable()
export class ProjectDirService {
  private readonly logger = new Logger(ProjectDirService.name)

  /** 物料根目录（容器内路径） */
  get root(): string {
    return path.resolve(config.projects.root)
  }

  /**
   * 解析项目目录的绝对路径，并确保它没有跑出根目录。
   * 这是硬隔离的底线，两道校验缺一不可：
   * 1. 先 resolve 再判前缀，拒绝 `..` 和绝对路径注入；
   * 2. 再拿真实路径（不存在的路径取最近的已存在父目录）判一次前缀，拒绝符号链接逃逸。
   *
   * 返回的仍是第一步解析出的路径，真实路径只用来校验，不改变对外的路径形态。
   */
  async resolveProjectPath(...segments: string[]): Promise<string> {
    const root = this.root
    const resolved = path.resolve(root, ...segments)
    this.assertInsideRoot(root, resolved)
    this.assertInsideRoot(await this.toRealPath(root), await this.toRealPath(resolved))

    return resolved
  }

  /**
   * 建出一个项目的完整物料目录。
   * 中途任何一步失败，都把已经建出来的部分清理干净，不留半成品。
   */
  async createProjectDir(info: ProjectDirInfo): Promise<string> {
    const projectDir = await this.resolveProjectPath(info.name)
    let created = false

    try {
      await mkdir(this.root, { recursive: true })
      // 不用 recursive：目录已存在时直接失败，避免覆盖别人的物料
      await mkdir(projectDir)
      created = true

      for (const subDir of PROJECT_SUB_DIRS) {
        const dir = await this.resolveProjectPath(info.name, subDir)
        await mkdir(dir, { recursive: true })
        await writeFile(path.join(dir, '.gitkeep'), '')
      }

      await writeFile(path.join(projectDir, 'CLAUDE.md'), this.buildClaudeMd(info), 'utf8')
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      this.logger.error(`创建项目目录失败: ${projectDir}`, error instanceof Error ? error.stack : String(error))
      if (created)
        await this.removeDir(projectDir)

      // 磁盘上已经有同名目录（例如上次部署留下的、数据库里没记录的孤儿目录）。
      // 这里只把报错换成「名字被占用」，行为不变：已存在的目录一个字节都不动。
      if (!created && code === 'EEXIST')
        throw new AppException(ResponseCode.ProjectNameTaken)

      throw new AppException(ResponseCode.ProjectDirCreateFailed)
    }

    return projectDir
  }

  /** 删除项目目录（回滚用），失败只记日志，不再往上抛 */
  async removeProjectDir(dirName: string): Promise<void> {
    await this.removeDir(await this.resolveProjectPath(dirName))
  }

  /**
   * 目录改名，归档与归档回滚都走这里。
   * 返回是否真的改了名：源目录不存在时返回 false（只记日志，不阻塞数据库侧的状态变更）。
   */
  async renameProjectDir(fromDirName: string, toDirName: string): Promise<boolean> {
    const from = await this.resolveProjectPath(fromDirName)
    const to = await this.resolveProjectPath(toDirName)

    try {
      await rename(from, to)
      return true
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.warn(`目录不存在，跳过改名: ${from}`)
        return false
      }

      this.logger.error(`目录改名失败: ${from} -> ${to}`, error instanceof Error ? error.stack : String(error))
      throw new AppException(ResponseCode.ProjectDirRenameFailed)
    }
  }

  /**
   * 重写项目根目录下的 CLAUDE.md，项目信息更新后调用。
   * 数据库那边已经写成功了，这里写文件失败只记日志、返回 false，不把整个更新接口拖失败。
   */
  async refreshClaudeMd(dirName: string, info: ProjectDirInfo): Promise<boolean> {
    try {
      const claudeMd = await this.resolveProjectPath(dirName, 'CLAUDE.md')
      await writeFile(claudeMd, this.buildClaudeMd(info), 'utf8')
      return true
    }
    catch (error) {
      this.logger.error(`重写 CLAUDE.md 失败: ${dirName}`, error instanceof Error ? error.stack : String(error))
      return false
    }
  }

  /** 项目根目录下的 CLAUDE.md，AI 服务的 Agent 会自动读取 */
  buildClaudeMd(info: ProjectDirInfo): string {
    const fill = (value?: string | null) => {
      const text = value?.trim()
      return text || EMPTY_FIELD_PLACEHOLDER
    }

    return [
      `# ${info.displayName}`,
      '',
      `> 这是「${info.displayName}」项目的物料目录。你（AI Agent）的工作范围**仅限本目录**，不要访问目录以外的任何路径。`,
      '',
      '## 项目信息',
      '',
      `- 英文名：${info.name}`,
      `- 说明：${fill(info.desc)}`,
      `- 面向谁：${fill(info.audience)}`,
      `- 想达成什么：${fill(info.goal)}`,
      '',
      '## 目录说明',
      '',
      '- `background/` —— 背景物料，真实客观的材料。写内容前先来这里翻，不要凭空编造',
      '  - `product/` 产品介绍、功能说明',
      '  - `website/` 网站文案、页面抓取',
      '  - `feedback/` 用户反馈、评论、差评',
      '  - `legal/` 隐私条款、协议',
      '- `angles/` —— 发布方向定义，一个方向一个文件',
      '- `drafts/` —— 生成的待发内容',
      '- `media/` —— 图片原件与说明文件',
      '',
      '## 规矩',
      '',
      '1. 事实只能来自 `background/`，缺材料就说缺，不要编',
      '2. 生成的内容放 `drafts/`，同时记下用了哪些物料、哪个方向',
      '3. 不要修改 `background/` 里的原始材料',
      '',
    ].join('\n')
  }

  private assertInsideRoot(root: string, target: string): void {
    if (target !== root && !target.startsWith(root + path.sep))
      throw new AppException(ResponseCode.ProjectPathEscape)
  }

  /**
   * 求路径的真实位置：一级级往上找到第一个真实存在的祖先做 realpath，
   * 再把剩下还没建出来的部分拼回去。这样目录还不存在时也能判断它将来会落在哪。
   *
   * 关键点：realpath 读不到 ≠ 这个路径不存在。指向根目录外、且目标文件还没建出来的
   * 软链（悬空软链）同样报 ENOENT，但 lstat 能看见软链本身，写入时系统会顺着它跑出根目录。
   * 所以把 ENOENT 当成「尚未创建」之前，必须先确认这一段真的不存在。
   */
  private async toRealPath(target: string): Promise<string> {
    const pending: string[] = []
    let current = target
    let hops = 0

    for (;;) {
      try {
        const real = await realpath(current)
        return pending.length > 0 ? path.join(real, ...pending) : real
      }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // 只有「还不存在」才继续往上找；其它错误（含软链成环的 ELOOP）说明这条路径没法证明是安全的，按越界处理
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          this.logger.error(`解析真实路径失败: ${current}`, error instanceof Error ? error.stack : String(error))
          throw new AppException(ResponseCode.ProjectPathEscape)
        }

        // 这一段其实是个悬空软链的话，接着解析它指向哪，不能当成「将来会建在根目录里」
        const linkTarget = await this.readSymlinkTarget(current)
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
          // 一路找到文件系统根都解析不出来，说明这条路径证明不了安全
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
  private async readSymlinkTarget(current: string): Promise<string | null> {
    try {
      const stats = await lstat(current)
      if (!stats.isSymbolicLink()) {
        // 条目实实在在存在，realpath 却解析不出来，解释不了就不放行
        this.logger.error(`路径存在但无法解析真实位置: ${current}`)
        throw new AppException(ResponseCode.ProjectPathEscape)
      }

      const link = await readlink(current)
      return path.resolve(path.dirname(current), link)
    }
    catch (error) {
      if (error instanceof AppException)
        throw error

      const code = (error as NodeJS.ErrnoException).code
      // 这一段（或它的上级）确实不存在，交给调用方继续往上找
      if (code === 'ENOENT' || code === 'ENOTDIR')
        return null

      this.logger.error(`读取软链失败: ${current}`, error instanceof Error ? error.stack : String(error))
      throw new AppException(ResponseCode.ProjectPathEscape)
    }
  }

  private async removeDir(dir: string): Promise<void> {
    try {
      await rm(dir, { recursive: true, force: true })
    }
    catch (error) {
      this.logger.error(`清理项目目录失败: ${dir}`, error instanceof Error ? error.stack : String(error))
    }
  }
}
