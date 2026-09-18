import { AppException, ResponseCode } from '@yikart/common'
import { parse as parseYaml } from 'yaml'
import { parseRelPathRequired } from '../projects/project-path.util'

/** 草稿都在项目目录的 `drafts/` 下面（contract-stage2 第二节） */
export const DRAFT_DIR = 'drafts'
/** 正文文件：frontmatter 放标题、平台、方向、话题、图片 */
export const DRAFT_CONTENT_FILE = 'content.md'
/** 血缘文件：用了哪些物料、哪个方向、什么提示词 */
export const DRAFT_META_FILE = 'meta.json'

const FRONT_MATTER_FENCE = '---'
const URL_PATTERN = /^https?:\/\//i

/**
 * 把 `drafts/<slug>` 拆成段。
 *
 * 前面少写 `drafts/` 的容忍掉（网页上常把草稿目录名当 id 传），
 * 但最终一定要落在 `drafts/` 里——快照只允许从草稿目录取，
 * 不能借这个接口把 `background/` 里的任何文件读出来。
 */
export function parseDraftPath(input?: string | null): string[] {
  const raw = (input ?? '').trim()
  if (raw.length === 0)
    throw new AppException(ResponseCode.PublishedPostDraftPathInvalid)

  let segments: string[]
  try {
    segments = parseRelPathRequired(raw)
  }
  catch {
    // 路径规则那一层的报错换成草稿自己的码，给人看得懂的话
    throw new AppException(ResponseCode.PublishedPostDraftPathInvalid)
  }

  if (segments[0] !== DRAFT_DIR)
    segments = [DRAFT_DIR, ...segments]

  if (segments.length < 2)
    throw new AppException(ResponseCode.PublishedPostDraftPathInvalid)

  return segments
}

/** yaml / json 里读出来的值可能是任何类型，只认能当字符串用的，其余当没填 */
export function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text.length > 0 ? text : undefined
  }

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  return undefined
}

/** 既认 yaml 数组，也认逗号分隔的一行（AI 写的 frontmatter 两种都可能） */
export function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => readString(item))
      .filter((item): item is string => !!item)
  }

  const single = readString(value)
  if (!single)
    return []

  return single
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

/** 取一个字段。索引签名下 TS 不让点号访问，统一走这里，免得满屏 `raw['x']` */
export function pick(record: Record<string, unknown> | null | undefined, key: string): unknown {
  return record ? record[key] : undefined
}

export function isHttpUrl(value: string): boolean {
  return URL_PATTERN.test(value)
}

/**
 * 拆出 frontmatter 和正文。
 * 没有 frontmatter 时整篇都算正文——AI 可能直接写了一段话，那也是能发的内容。
 * frontmatter 有但 yaml 解析不了才报错。
 */
export function parseFrontMatter(text: string): { meta: Record<string, unknown>, body: string } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

  if (!normalized.startsWith(`${FRONT_MATTER_FENCE}\n`))
    return { meta: {}, body: normalized.trim() }

  const end = normalized.indexOf(`\n${FRONT_MATTER_FENCE}`, FRONT_MATTER_FENCE.length)
  if (end < 0)
    return { meta: {}, body: normalized.trim() }

  const frontText = normalized.slice(FRONT_MATTER_FENCE.length + 1, end)
  const body = normalized
    .slice(end + FRONT_MATTER_FENCE.length + 1)
    .replace(/^\n+/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = parseYaml(frontText)
  }
  catch {
    throw new AppException(ResponseCode.PublishedPostDraftInvalid)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { meta: {}, body }

  return { meta: parsed as Record<string, unknown>, body }
}

/** 图片名片文件名：原件名后面直接加 `.md`（`media/a.png` -> `media/a.png.md`） */
export function toImageCardSegments(mediaPath: string): string[] {
  const segments = parseRelPathRequired(mediaPath)
  const last = segments[segments.length - 1]!
  return [...segments.slice(0, -1), `${last}.md`]
}
