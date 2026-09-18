import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { AngleSource, AngleStatus } from '@yikart/mongodb'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { ProjectDirService } from '../projects/project-dir.service'
import { MAX_TEXT_FILE_BYTES } from '../projects/project-path.util'
import { safeMkdir, safeReaddir, safeReadFile, safeRemove, safeRename, safeWriteFile } from '../projects/safe-fs'
import { ANGLE_DIR, ANGLE_FILE_EXT, angleRelPath, isValidAngleSlug } from './angle-slug.util'

/**
 * 方向指引文件的读写。
 *
 * 分界（contract-core.md 第五节）：**数据库存元信息与血统，文件存写作指引**。
 * 所以这里只管 `<项目目录>/angles/<slug>.md` 这一个文件，不碰数据库。
 *
 * 文件操作一律走阶段 1 的 `safe-fs`：那边做了路径隔离和竞态防护，
 * 自己写 `fs` 调用等于把洞重新打开。
 */

/** 新建方向时文件正文的占位，不替人编造写作指引 */
export const DEFAULT_ANGLE_GUIDE_BODY = '（这个方向具体怎么写：切什么痛点、用什么噱头、什么语气、避开什么。）'

/** 写进文件 frontmatter 的元信息 */
export interface AngleGuideMeta {
  slug: string
  name: string
  desc?: string | null
  source: AngleSource
  /** 血统在文件里记的是父方向的 slug，不是 id——文件要能被人和 AI 直接读懂 */
  parentSlug?: string | null
  status: AngleStatus
  sourceAssetPaths?: string[] | null
  /** 提炼时用的提示词。血缘归因的一环，重写 frontmatter 时不能丢 */
  promptSnapshot?: string | null
}

/** 从文件里读出来的 frontmatter，全是可选：AI 写的文件缺字段是常态，不能因此报废 */
export interface ParsedAngleMeta {
  slug?: string
  name?: string
  desc?: string
  source?: string
  parentSlug?: string
  status?: string
  sourceAssetPaths?: string[]
  promptSnapshot?: string
}

export interface AngleGuideFile {
  path: string
  meta: ParsedAngleMeta
  body: string
}

const FRONT_MATTER_FENCE = '---'

function isAppExceptionWith(error: unknown, code: ResponseCode): boolean {
  return error instanceof AppException && error.code === code
}

/** yaml 里读出来的值可能是任何类型，只认字符串，其余当没填 */
function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text.length > 0 ? text : undefined
  }

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  return undefined
}

/** 来源路径列表：既认 yaml 数组，也认逗号分隔的一行字符串（AI 两种都可能写） */
function readStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value.map(item => readString(item)).filter((item): item is string => !!item)
    return list.length > 0 ? list : undefined
  }

  const single = readString(value)
  if (!single)
    return undefined

  const list = single.split(',').map(item => item.trim()).filter(item => item.length > 0)
  return list.length > 0 ? list : undefined
}

/**
 * 写进文件的 frontmatter，字段顺序就是契约里示例的顺序。
 *
 * 血缘字段的名字和数据库字段（`sourceAssetPaths` / `promptSnapshot`）保持一致，
 * 也和 AI 技能 `extracting-angles` 写出来的名字一致。
 * 旧名 `sourceAssets` / `prompt` 只在读的时候继续认，不再写出去。
 */
interface AngleFrontMatter {
  slug: string
  name: string
  source: AngleSource
  parent: string | null
  status: AngleStatus
  desc?: string
  sourceAssetPaths?: string[]
  promptSnapshot?: string
}

/** 拼出 `angles/<slug>.md` 的完整内容：frontmatter + 写作指引正文 */
export function buildAngleGuide(meta: AngleGuideMeta, body: string): string {
  const front: AngleFrontMatter = {
    slug: meta.slug,
    name: meta.name,
    source: meta.source,
    parent: meta.parentSlug ?? null,
    status: meta.status,
  }

  const desc = meta.desc?.trim()
  if (desc)
    front.desc = desc

  // 读的时候认哪些血缘字段，写的时候就得写回哪些，否则重写一次 frontmatter 就断链
  const sourceAssetPaths = readStringList(meta.sourceAssetPaths)
  if (sourceAssetPaths)
    front.sourceAssetPaths = sourceAssetPaths

  const promptSnapshot = readString(meta.promptSnapshot)
  if (promptSnapshot)
    front.promptSnapshot = promptSnapshot

  const frontText = stringifyYaml(front).trimEnd()
  const bodyText = body.trim().length > 0 ? body.trim() : DEFAULT_ANGLE_GUIDE_BODY

  return `${FRONT_MATTER_FENCE}\n${frontText}\n${FRONT_MATTER_FENCE}\n\n${bodyText}\n`
}

/**
 * 拆出 frontmatter 和正文。没有 frontmatter 时整篇都算正文（AI 可能直接写了一段话）。
 * frontmatter 有但解析不了才报 `AngleFileInvalid`。
 */
export function parseAngleGuide(text: string): { meta: ParsedAngleMeta, body: string } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

  if (!normalized.startsWith(`${FRONT_MATTER_FENCE}\n`))
    return { meta: {}, body: normalized.trim() }

  const end = normalized.indexOf(`\n${FRONT_MATTER_FENCE}`, FRONT_MATTER_FENCE.length)
  if (end < 0)
    return { meta: {}, body: normalized.trim() }

  const frontText = normalized.slice(FRONT_MATTER_FENCE.length + 1, end)
  const rest = normalized.slice(end + FRONT_MATTER_FENCE.length + 1)
  const body = rest.replace(/^\n+/, '').trim()

  let parsed: unknown
  try {
    parsed = parseYaml(frontText)
  }
  catch {
    throw new AppException(ResponseCode.AngleFileInvalid)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { meta: {}, body }

  const raw = parsed as Record<string, unknown>
  const at = (key: string): unknown => raw[key]

  return {
    meta: {
      slug: readString(at('slug')),
      name: readString(at('name')),
      desc: readString(at('desc')),
      source: readString(at('source')),
      parentSlug: readString(at('parent')) ?? readString(at('parentSlug')),
      status: readString(at('status')),
      // 标准名优先，旧名（`sourceAssets` / `prompt`）只保留读兼容
      sourceAssetPaths: readStringList(at('sourceAssetPaths')) ?? readStringList(at('sourceAssets')),
      promptSnapshot: readString(at('promptSnapshot')) ?? readString(at('prompt')),
    },
    body,
  }
}

@Injectable()
export class AngleFileService {
  private readonly logger = new Logger(AngleFileService.name)

  constructor(
    private readonly projectDirService: ProjectDirService,
  ) {}

  /** 读一个方向的指引文件；文件不在报 `AngleFileNotFound` */
  async read(dirName: string, slug: string): Promise<AngleGuideFile> {
    try {
      const { content } = await safeReadFile(
        this.projectDirService.root,
        [dirName, ANGLE_DIR, `${slug}${ANGLE_FILE_EXT}`],
        MAX_TEXT_FILE_BYTES,
      )

      const { meta, body } = parseAngleGuide(content.toString('utf8'))
      return { path: angleRelPath(slug), meta, body }
    }
    catch (error) {
      if (error instanceof AppException) {
        if (error.code === ResponseCode.ProjectFileNotFound)
          throw new AppException(ResponseCode.AngleFileNotFound)

        throw error
      }

      this.logger.error(
        `读方向指引文件失败: ${dirName}/${angleRelPath(slug)}`,
        error instanceof Error ? error.stack : String(error),
      )
      throw new AppException(ResponseCode.AngleFileNotFound)
    }
  }

  /** 读正文，读不到（文件缺失、格式不对）返回 null，让调用方自己决定怎么兜底 */
  async readBody(dirName: string, slug: string): Promise<string | null> {
    try {
      const { body } = await this.read(dirName, slug)
      return body
    }
    catch (error) {
      this.logger.warn(
        `方向指引文件读不到，按空正文处理: ${dirName}/${angleRelPath(slug)} ${error instanceof AppException ? error.code : error}`,
      )
      return null
    }
  }

  /**
   * 写回前把「只在文件里」的血缘补上。
   *
   * 调用方（`angles.service`）手上只有数据库那份元信息，提示词快照这类由 AI 写进文件的字段它给不出来；
   * 不补一下的话，网页改一次方向就把血缘抹掉了，「这条内容是哪个方向、什么提示词生成的」再也归不了因。
   * 调用方明确给了值就以调用方为准；文件读不到（还没建、格式坏了）就当没有，绝不因此让写入失败。
   */
  private async carryOverLineage(dirName: string, meta: AngleGuideMeta): Promise<AngleGuideMeta> {
    const ownPaths = readStringList(meta.sourceAssetPaths)
    const ownPrompt = readString(meta.promptSnapshot)
    if (ownPaths && ownPrompt)
      return meta

    let previous: ParsedAngleMeta
    try {
      previous = (await this.read(dirName, meta.slug)).meta
    }
    catch {
      return meta
    }

    return {
      ...meta,
      sourceAssetPaths: ownPaths ?? previous.sourceAssetPaths,
      promptSnapshot: ownPrompt ?? previous.promptSnapshot,
    }
  }

  /** 写一个方向的指引文件，目录不存在会先补出来 */
  async write(dirName: string, meta: AngleGuideMeta, body: string): Promise<void> {
    const root = this.projectDirService.root
    const content = Buffer.from(buildAngleGuide(await this.carryOverLineage(dirName, meta), body), 'utf8')

    // 上限和物料文本文件一致，免得有人把整本书塞进写作指引
    if (content.length > MAX_TEXT_FILE_BYTES)
      throw new AppException(ResponseCode.ProjectFileTooLarge)

    try {
      await safeMkdir(root, [dirName, ANGLE_DIR], { existOk: true })
      await safeWriteFile(root, [dirName, ANGLE_DIR, `${meta.slug}${ANGLE_FILE_EXT}`], content)
    }
    catch (error) {
      this.logger.error(
        `写方向指引文件失败: ${dirName}/${angleRelPath(meta.slug)}`,
        error instanceof Error ? error.stack : String(error),
      )
      throw new AppException(ResponseCode.AngleFileWriteFailed)
    }
  }

  /** 改 slug 时同步改文件名。目标已存在、源不存在都算失败，交给调用方回滚数据库 */
  async rename(dirName: string, fromSlug: string, toSlug: string): Promise<void> {
    try {
      await safeRename(
        this.projectDirService.root,
        [dirName, ANGLE_DIR, `${fromSlug}${ANGLE_FILE_EXT}`],
        [dirName, ANGLE_DIR, `${toSlug}${ANGLE_FILE_EXT}`],
      )
    }
    catch (error) {
      this.logger.error(
        `方向指引文件改名失败: ${dirName}/${angleRelPath(fromSlug)} -> ${angleRelPath(toSlug)}`,
        error instanceof Error ? error.stack : String(error),
      )
      throw new AppException(ResponseCode.AngleFileRenameFailed)
    }
  }

  /** 删方向时同时删文件。文件本来就不在不算失败（重试删除要能删干净） */
  async remove(dirName: string, slug: string): Promise<void> {
    try {
      await safeRemove(this.projectDirService.root, [dirName, ANGLE_DIR, `${slug}${ANGLE_FILE_EXT}`])
    }
    catch (error) {
      if (isAppExceptionWith(error, ResponseCode.ProjectFileNotFound)) {
        this.logger.warn(`方向指引文件已不存在，跳过删除: ${dirName}/${angleRelPath(slug)}`)
        return
      }

      this.logger.error(
        `方向指引文件删除失败: ${dirName}/${angleRelPath(slug)}`,
        error instanceof Error ? error.stack : String(error),
      )
      throw new AppException(ResponseCode.AngleFileDeleteFailed)
    }
  }

  /** 列出 `angles/` 下所有合规的 slug；目录不存在返回空数组 */
  async listSlugs(dirName: string): Promise<string[]> {
    try {
      const entries = await safeReaddir(this.projectDirService.root, [dirName, ANGLE_DIR], ANGLE_DIR)

      return entries
        .filter(entry => entry.type === 'file' && entry.name.endsWith(ANGLE_FILE_EXT))
        .map(entry => entry.name.slice(0, -ANGLE_FILE_EXT.length))
        .filter(slug => isValidAngleSlug(slug))
    }
    catch (error) {
      if (isAppExceptionWith(error, ResponseCode.ProjectFileNotFound))
        return []

      this.logger.error(
        `列方向指引文件失败: ${dirName}/${ANGLE_DIR}`,
        error instanceof Error ? error.stack : String(error),
      )
      throw new AppException(ResponseCode.AngleFileNotFound)
    }
  }
}
