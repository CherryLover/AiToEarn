import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { ProjectDirService } from '../projects/project-dir.service'
import { MAX_TEXT_FILE_BYTES } from '../projects/project-path.util'
import { safeReadFile } from '../projects/safe-fs'
import {
  DRAFT_CONTENT_FILE,
  DRAFT_META_FILE,
  isHttpUrl,
  parseDraftPath,
  parseFrontMatter,
  pick,
  readString,
  readStringList,
  toImageCardSegments,
} from './draft-files.util'

/** 图片没进快照的原因，给人看的时候翻译成人话 */
export type SkippedMediaReason
  /** 找不到名片文件，或者名片读不了 */
  = | 'card_missing'
  /** 名片在，但 `oss` 是空的——当初传 OSS 失败了 */
    | 'oss_missing'

export interface SkippedMedia {
  /** 相对项目根的图片路径 */
  path: string
  reason: SkippedMediaReason
}

/** 点「准备发布」那一刻从草稿文件里抄下来的内容 */
export interface DraftSnapshot {
  title: string
  body: string
  topics: string[]
  mediaUrls: string[]
}

export interface DraftSnapshotResult {
  /** 归一化之后的草稿目录，相对项目根 */
  draftPath: string
  snapshot: DraftSnapshot
  /** 草稿血缘里记的方向 slug，用来把发布记录挂回方向 */
  angleSlug?: string
  /** 草稿自己标的平台，可能是空（平台中立的草稿） */
  draftPlatform?: string
  /** 名片里没有 OSS 地址、没进快照的图片 */
  skippedMedia: SkippedMedia[]
}

/** 一张图在快照里的候选来源 */
interface MediaCandidate {
  /** 去重用的键：能定位到本地文件就用本地路径，否则用地址本身 */
  key: string
  /** 相对项目根的本地图片路径，拿不到就是 undefined */
  localPath?: string
  /** 草稿里直接写的地址 */
  url?: string
}

function isAppExceptionWith(error: unknown, code: ResponseCode): boolean {
  return error instanceof AppException && error.code === code
}

/**
 * 把一份草稿抄成发布快照。
 *
 * 两条硬约束：
 * 1. **必须是快照，不能只存路径**（contract-skeleton 第四节）。草稿在排队期间会被改，
 *    发出去的应该是点下「准备发布」那一刻的版本。
 * 2. **文件一律走 `safe-fs`**（contract-stage1）。自己写 `fs` 调用等于把路径隔离的洞重新打开。
 */
@Injectable()
export class DraftSnapshotService {
  private readonly logger = new Logger(DraftSnapshotService.name)

  constructor(
    private readonly projectDirService: ProjectDirService,
  ) {}

  async read(dirName: string, draftPath: string): Promise<DraftSnapshotResult> {
    const segments = parseDraftPath(draftPath)
    const content = await this.readContent(dirName, segments)
    const meta = await this.readMeta(dirName, segments)

    const { meta: front, body } = parseFrontMatter(content)

    const title = readString(pick(front, 'title')) ?? ''
    const topics = readStringList(pick(front, 'topics'))

    // 标题和正文都空的草稿没东西可发，早点拦住比发出去一条空帖子强
    if (title.length === 0 && body.length === 0)
      throw new AppException(ResponseCode.PublishedPostDraftEmpty)

    const { mediaUrls, skippedMedia } = await this.resolveMediaUrls(dirName, pick(front, 'images'), meta)

    return {
      draftPath: segments.join('/'),
      snapshot: { title, body, topics, mediaUrls },
      angleSlug: readString(pick(meta, 'angleSlug')) ?? readString(pick(front, 'angle')),
      draftPlatform: readString(pick(meta, 'platform')) ?? readString(pick(front, 'platform')),
      skippedMedia,
    }
  }

  private async readContent(dirName: string, segments: string[]): Promise<string> {
    try {
      const { content } = await safeReadFile(
        this.projectDirService.root,
        [dirName, ...segments, DRAFT_CONTENT_FILE],
        MAX_TEXT_FILE_BYTES,
      )
      return content.toString('utf8')
    }
    catch (error) {
      if (isAppExceptionWith(error, ResponseCode.ProjectFileNotFound))
        throw new AppException(ResponseCode.PublishedPostDraftNotFound)

      if (error instanceof AppException)
        throw error

      this.logger.error(error, `读草稿正文失败: ${dirName}/${segments.join('/')}/${DRAFT_CONTENT_FILE}`)
      throw new AppException(ResponseCode.PublishedPostDraftNotFound)
    }
  }

  /**
   * 血缘文件是锦上添花：缺了、坏了都只记日志。
   * 发布靠的是 `content.md`，不该因为一份 JSON 写歪了就发不出去。
   */
  private async readMeta(dirName: string, segments: string[]): Promise<Record<string, unknown> | null> {
    let text: string
    try {
      const { content } = await safeReadFile(
        this.projectDirService.root,
        [dirName, ...segments, DRAFT_META_FILE],
        MAX_TEXT_FILE_BYTES,
      )
      text = content.toString('utf8')
    }
    catch (error) {
      this.logger.warn(error, `草稿血缘文件读不到，按没有处理: ${dirName}/${segments.join('/')}/${DRAFT_META_FILE}`)
      return null
    }

    try {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null

      return parsed as Record<string, unknown>
    }
    catch {
      this.logger.warn(`草稿血缘文件不是合法 JSON，按没有处理: ${dirName}/${segments.join('/')}/${DRAFT_META_FILE}`)
      return null
    }
  }

  /**
   * 算出快照里的图片地址。
   *
   * 地址**以名片文件里的 `oss` 为准**（contract-stage4）：图片可能被重新上传过，
   * 名片是最新的那一份，草稿里写的只是生成那一刻的副本。
   * 名片里 `oss` 是空的（当初传 OSS 失败）就跳过这张图，并在返回里说明跳了哪些——
   * 本地路径塞进快照没有任何意义，执行端下载不到。
   */
  private async resolveMediaUrls(
    dirName: string,
    rawImages: unknown,
    meta: Record<string, unknown> | null,
  ): Promise<{ mediaUrls: string[], skippedMedia: SkippedMedia[] }> {
    const candidates = this.collectCandidates(rawImages, meta)
    const mediaUrls: string[] = []
    const skippedMedia: SkippedMedia[] = []
    const seenUrls = new Set<string>()

    for (const candidate of candidates) {
      if (!candidate.localPath) {
        // 只有地址、找不到对应的本地图片（血缘文件缺失时的常态）：
        // 这地址本来就是生成时从名片里抄过去的，按原样用
        if (candidate.url && !seenUrls.has(candidate.url)) {
          seenUrls.add(candidate.url)
          mediaUrls.push(candidate.url)
        }
        continue
      }

      const oss = await this.readCardOss(dirName, candidate.localPath)
      if (oss === null) {
        skippedMedia.push({ path: candidate.localPath, reason: 'card_missing' })
        continue
      }

      if (oss.length === 0) {
        skippedMedia.push({ path: candidate.localPath, reason: 'oss_missing' })
        continue
      }

      if (!seenUrls.has(oss)) {
        seenUrls.add(oss)
        mediaUrls.push(oss)
      }
    }

    return { mediaUrls, skippedMedia }
  }

  /**
   * 收集候选图片，按展示顺序。
   *
   * `content.md` 的 `images` 是展示顺序，优先；`meta.json` 的 `mediaRefs` 带本地路径，
   * 用来把地址反查回本地文件，也补上正文里漏写的图。
   */
  private collectCandidates(rawImages: unknown, meta: Record<string, unknown> | null): MediaCandidate[] {
    const rawRefs = pick(meta, 'mediaRefs')
    const refs = Array.isArray(rawRefs) ? rawRefs : []
    const urlToLocal = new Map<string, string>()
    const localPaths: string[] = []

    for (const ref of refs) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref))
        continue

      const item = ref as Record<string, unknown>
      const file = readString(pick(item, 'file'))
      const oss = readString(pick(item, 'oss'))

      if (file) {
        localPaths.push(file)
        if (oss)
          urlToLocal.set(oss, file)
      }
    }

    const candidates: MediaCandidate[] = []
    const seen = new Set<string>()
    const push = (candidate: MediaCandidate) => {
      if (seen.has(candidate.key))
        return
      seen.add(candidate.key)
      candidates.push(candidate)
    }

    for (const entry of readStringList(rawImages)) {
      if (isHttpUrl(entry)) {
        const localPath = urlToLocal.get(entry)
        push({ key: localPath ?? entry, localPath, url: entry })
      }
      else {
        push({ key: entry, localPath: entry })
      }
    }

    for (const localPath of localPaths)
      push({ key: localPath, localPath })

    return candidates
  }

  /**
   * 读一张图的名片，取 `oss` 字段。
   * 返回 null 表示名片压根读不到，空串表示名片在但没有 OSS 地址——两种情况给的话不一样。
   */
  private async readCardOss(dirName: string, mediaPath: string): Promise<string | null> {
    let cardSegments: string[]
    try {
      cardSegments = toImageCardSegments(mediaPath)
    }
    catch {
      this.logger.warn(`草稿引用的图片路径不合法，跳过: ${dirName}/${mediaPath}`)
      return null
    }

    try {
      const { content } = await safeReadFile(
        this.projectDirService.root,
        [dirName, ...cardSegments],
        MAX_TEXT_FILE_BYTES,
      )

      const { meta } = parseFrontMatter(content.toString('utf8'))
      return readString(pick(meta, 'oss')) ?? ''
    }
    catch (error) {
      this.logger.warn(error, `图片名片读不到，这张图不进快照: ${dirName}/${cardSegments.join('/')}`)
      return null
    }
  }
}
