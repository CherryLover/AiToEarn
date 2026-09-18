import type { Stats } from 'node:fs'
import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { ProjectDirService } from '../projects/project-dir.service'
import { MAX_TEXT_FILE_BYTES } from '../projects/project-path.util'
import { safeLstat, safeReadFile } from '../projects/safe-fs'
import {
  DRAFT_CONTENT_FILE,
  DRAFT_META_FILE,
  isHttpUrl,
  parseDraftPath,
  parseDraftSections,
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

/**
 * 一份草稿在磁盘上的摆法。
 *
 * - **目录版** `drafts/<slug>/`：正文在 `content.md`，血缘在同目录的 `meta.json`（AI 生成的走这种）
 * - **单文件版** `drafts/<名字>.md`：正文就是这个文件本身，没有血缘文件（人手工放的走这种）
 */
interface DraftLayout {
  /** 正文文件，相对项目目录 */
  contentSegments: string[]
  /** 血缘文件，单文件版没有 */
  metaSegments?: string[]
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
    const layout = await this.resolveLayout(dirName, segments)
    const content = await this.readContent(dirName, layout.contentSegments)
    const meta = layout.metaSegments ? await this.readMeta(dirName, layout.metaSegments) : null

    const { meta: front, body: rawBody } = parseFrontMatter(content)

    // 人手工放的单文件草稿没有 frontmatter，内容靠 `## 标题` / `## 正文` / `## 话题` 分段，
    // 前面还压着一段自己记账用的清单。整篇当正文抄下来，复制出去的就是没法直接发的东西。
    // 目录版的 content.md 是生成出来的、一直带 frontmatter，不走这条兜底。
    const sections = layout.metaSegments ? null : parseDraftSections(rawBody)

    const frontTopics = readStringList(pick(front, 'topics'))

    const title = readString(pick(front, 'title')) ?? sections?.title ?? ''
    const topics = frontTopics.length > 0 ? frontTopics : sections?.topics ?? []
    const body = sections?.body ?? rawBody

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

  /**
   * 看磁盘上这个路径到底是文件还是目录，据此决定正文和血缘各在哪儿。
   *
   * **不能靠有没有 `.md` 后缀去猜**：线上用户手工放进来的三份单文件草稿就是这么被判成目录版的，
   * 拼出 `drafts/xxx.md/content.md` 一读就报「草稿不存在」，发布页对他实际拥有的内容一份都用不了。
   * 判定走 `safe-fs` 的 `safeLstat`，和读文件同一套路径隔离，不另开一条绕过校验的 `fs` 调用。
   */
  private async resolveLayout(dirName: string, segments: string[]): Promise<DraftLayout> {
    const entry = await this.statDraft(dirName, segments)

    if (entry.isDirectory()) {
      return {
        contentSegments: [...segments, DRAFT_CONTENT_FILE],
        metaSegments: [...segments, DRAFT_META_FILE],
      }
    }

    if (entry.isFile())
      return { contentSegments: segments }

    // 软链、设备文件之类：路径是在的，但它不是一份草稿，和「草稿不存在」要分开说
    throw new AppException(ResponseCode.PublishedPostDraftInvalid)
  }

  private async statDraft(dirName: string, segments: string[]): Promise<Stats> {
    try {
      return await safeLstat(this.projectDirService.root, [dirName, ...segments])
    }
    catch (error) {
      if (isAppExceptionWith(error, ResponseCode.ProjectFileNotFound))
        throw new AppException(ResponseCode.PublishedPostDraftNotFound)

      // 拿单文件草稿当目录往下钻（`drafts/x.md/content.md`）时，safe-fs 报的是物料那一段的
      // 「路径不合法」。原样漏出去网页认不出来，只能显示通用文案，翻成草稿自己的码
      if (isAppExceptionWith(error, ResponseCode.ProjectFilePathInvalid))
        throw new AppException(ResponseCode.PublishedPostDraftPathInvalid)

      if (error instanceof AppException)
        throw error

      this.logger.error(error, `草稿路径看不了: ${dirName}/${segments.join('/')}`)
      throw new AppException(ResponseCode.PublishedPostDraftNotFound)
    }
  }

  private async readContent(dirName: string, contentSegments: string[]): Promise<string> {
    try {
      const { content } = await safeReadFile(
        this.projectDirService.root,
        [dirName, ...contentSegments],
        MAX_TEXT_FILE_BYTES,
      )
      return content.toString('utf8')
    }
    catch (error) {
      if (isAppExceptionWith(error, ResponseCode.ProjectFileNotFound))
        throw new AppException(ResponseCode.PublishedPostDraftNotFound)

      if (error instanceof AppException)
        throw error

      this.logger.error(error, `读草稿正文失败: ${dirName}/${contentSegments.join('/')}`)
      throw new AppException(ResponseCode.PublishedPostDraftNotFound)
    }
  }

  /**
   * 血缘文件是锦上添花：缺了、坏了都只记日志。
   * 发布靠的是正文，不该因为一份 JSON 写歪了就发不出去。
   * 单文件版草稿压根没有这个文件，血缘从 frontmatter 里读，也不报错。
   */
  private async readMeta(dirName: string, metaSegments: string[]): Promise<Record<string, unknown> | null> {
    let text: string
    try {
      const { content } = await safeReadFile(
        this.projectDirService.root,
        [dirName, ...metaSegments],
        MAX_TEXT_FILE_BYTES,
      )
      text = content.toString('utf8')
    }
    catch (error) {
      this.logger.warn(error, `草稿血缘文件读不到，按没有处理: ${dirName}/${metaSegments.join('/')}`)
      return null
    }

    try {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return null

      return parsed as Record<string, unknown>
    }
    catch {
      this.logger.warn(`草稿血缘文件不是合法 JSON，按没有处理: ${dirName}/${metaSegments.join('/')}`)
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
