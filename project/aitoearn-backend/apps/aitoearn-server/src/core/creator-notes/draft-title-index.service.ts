import { Injectable, Logger } from '@nestjs/common'
import { ProjectRepository, ProjectStatus } from '@yikart/mongodb'
import { ProjectDirService } from '../projects/project-dir.service'
import { safeReaddir } from '../projects/safe-fs'
import { DRAFT_DIR } from '../publishing/draft-files.util'
import { DraftSnapshotService } from '../publishing/draft-snapshot.service'

/** 一份草稿在匹配时用得到的那几项 */
export interface DraftRef {
  projectId: string
  draftPath: string
  title: string
  angleSlug?: string
}

/**
 * 一次采集里最多读多少份草稿。
 *
 * 匹配要扫**所有项目**的 `drafts/`，每份草稿是一到两次磁盘读。
 * 不封顶的话，项目多起来之后一个工单回报就能把事件循环占住好几秒
 * （`safeReaddir` 那一段是同步的，锁住目录再 `readdirSync`）。
 * 撞到上限只会让后面的草稿匹配不上、落进未归属，数据一条都不会丢。
 */
const MAX_DRAFTS_SCANNED = 500

/**
 * 按标题找草稿。
 *
 * 匹配规则第 2 条（contract-collect-xhs 第三节）要的就是这个：
 * 用户手工发出去的帖子，草稿还在项目目录里，标题能对上就能自动归到正确的项目和方向上。
 * **这是整套方案能全自动的关键**——没有它，65 条里那 3 条也得人手动认领。
 *
 * 索引是一次采集算一次，不做跨请求缓存：草稿是用户随时在改的文件，
 * 缓存过期的后果是「明明标题对得上却没归属」，排查起来比多读几个文件贵得多。
 */
@Injectable()
export class DraftTitleIndexService {
  private readonly logger = new Logger(DraftTitleIndexService.name)

  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly projectDirService: ProjectDirService,
    private readonly draftSnapshotService: DraftSnapshotService,
  ) {}

  /** 这个用户所有在用项目里的草稿，按标题归组（同名草稿会有多条） */
  async buildByUserId(userId: string): Promise<Map<string, DraftRef[]>> {
    const projects = await this.projectRepository.listByUserId(userId, ProjectStatus.ACTIVE)
    const index = new Map<string, DraftRef[]>()
    let scanned = 0

    for (const project of projects) {
      const entries = await this.listDraftEntries(project.dirName)

      for (const entry of entries) {
        if (scanned >= MAX_DRAFTS_SCANNED) {
          this.logger.warn(`草稿扫描到上限 ${MAX_DRAFTS_SCANNED} 份就停了，后面的这次不参与匹配`)
          return index
        }
        scanned++

        const ref = await this.readRef(project.id, project.dirName, entry)
        if (!ref)
          continue

        const key = normalizeTitle(ref.title)
        if (key.length === 0)
          continue

        const bucket = index.get(key)
        if (bucket)
          bucket.push(ref)
        else
          index.set(key, [ref])
      }
    }

    return index
  }

  /** `drafts/` 下面每一项都可能是草稿：目录版和单文件版都算 */
  private async listDraftEntries(dirName: string): Promise<string[]> {
    try {
      const entries = await safeReaddir(this.projectDirService.root, [dirName, DRAFT_DIR], DRAFT_DIR)
      return entries.map(entry => `${DRAFT_DIR}/${entry.name}`)
    }
    catch {
      // 项目还没建 `drafts/` 是常态，不是错误
      return []
    }
  }

  private async readRef(projectId: string, dirName: string, draftPath: string): Promise<DraftRef | null> {
    try {
      const draft = await this.draftSnapshotService.readTitle(dirName, draftPath)
      if (draft.title.length === 0)
        return null

      return {
        projectId,
        draftPath: draft.draftPath,
        title: draft.title,
        angleSlug: draft.angleSlug,
      }
    }
    catch (error) {
      // 一份读不了的草稿不该让整次匹配失败：它只是匹配不上
      this.logger.warn(error, `草稿读不了，这次匹配跳过: ${dirName}/${draftPath}`)
      return null
    }
  }
}

/**
 * 标题归一化：去首尾空白、把连续空白压成一个、大小写不敏感。
 *
 * 不做更激进的处理（比如去掉标点、去掉 emoji）：那会让两条只差一个符号的帖子
 * 匹配成同一份草稿，而这种错是静默的——数据算到别的方向上去了，页面上一切正常。
 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 标题被平台截断时，去掉末尾省略号拿到可以做前缀比对的部分 */
export function toTitlePrefix(title: string): string {
  return title.trim().replace(/…+$/, '').replace(/\.{3,}$/, '').trim()
}
