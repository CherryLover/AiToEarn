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

/**
 * 小节式草稿的兜底解析。
 *
 * 人手工写的草稿没有 frontmatter，内容是用 `## 标题` / `## 正文` / `## 话题` 分的段，
 * 前面还压着一段自己记账用的清单（状态、发布时间、数据、配图……）。
 * 整篇当正文发出去就是把这段记账一起发了，所以这里按小节把能发的那部分挑出来。
 *
 * **只认这三个词**，别的小节一概不猜、不动。
 */
const SECTION_TITLE = '标题'
const SECTION_BODY = '正文'
const SECTION_TOPICS = '话题'
const SECTION_NAMES = new Set([SECTION_TITLE, SECTION_BODY, SECTION_TOPICS])

const HEADING_PATTERN = /^(#{1,6})([ \t]*)(\S.*)?$/
/** 话题写成 `#怀孕 #备孕`，存进快照的要的是词，不是原文 */
const TOPIC_PATTERN = /#([^\s#]+)/g

export interface DraftSections {
  /** `## 标题` 小节的内容，没有这一节就退到首个一级标题 */
  title?: string
  /** `## 正文` 小节的内容；没有这一节就是 undefined，调用方保留原来的整篇正文 */
  body?: string
  /** `## 话题` 小节里的 `#xxx`，井号已经去掉 */
  topics: string[]
}

interface Heading {
  level: number
  text: string
}

/**
 * 认一行是不是小节标题。
 *
 * 井号后面要有空格才算标题，只有「标题 / 正文 / 话题」这三个词允许贴着写（`##标题`）。
 * 放宽到「任何井号开头都算标题」会把话题那一行 `#怀孕 #备孕` 当成一级标题，
 * 话题小节当场变成空的。
 */
function readHeading(line: string): Heading | null {
  const match = HEADING_PATTERN.exec(line)
  if (!match)
    return null

  const text = (match[3] ?? '').trim()
  if (text.length === 0)
    return null

  if (match[2]!.length === 0 && !SECTION_NAMES.has(text))
    return null

  return { level: match[1]!.length, text }
}

function joinSection(lines: string[]): string {
  return lines.join('\n').trim()
}

function readTopics(lines: string[]): string[] {
  const topics: string[] = []

  for (const match of lines.join('\n').matchAll(TOPIC_PATTERN)) {
    const topic = match[1]!.trim()
    if (topic.length > 0 && !topics.includes(topic))
      topics.push(topic)
  }

  return topics
}

/**
 * 按 `##` 小节拆一份没有 frontmatter 的草稿。
 * 三个小节一个都没有时 `body` 是 undefined，调用方照旧把整篇当正文，不报错。
 */
export function parseDraftSections(text: string): DraftSections {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
  const sections = new Map<string, string[]>()
  let firstHeading: string | undefined
  let current: string[] | undefined

  for (const line of lines) {
    const heading = readHeading(line)

    // 三级以下是小节内部的结构，照抄进内容里，不当成小节边界
    if (!heading || heading.level > 2) {
      current?.push(line)
      continue
    }

    if (heading.level === 1 && firstHeading === undefined)
      firstHeading = heading.text

    // 认识的小节才开始收，别的小节（数据、配图、备注……）只起「上一节到此为止」的作用
    current = heading.level === 2 && SECTION_NAMES.has(heading.text) && !sections.has(heading.text)
      ? []
      : undefined

    if (current)
      sections.set(heading.text, current)
  }

  const titleLines = sections.get(SECTION_TITLE)
  const bodyLines = sections.get(SECTION_BODY)
  const topicLines = sections.get(SECTION_TOPICS)

  const title = titleLines
    ? titleLines.map(line => line.trim()).find(line => line.length > 0)
    : undefined
  const body = bodyLines ? joinSection(bodyLines) : ''

  return {
    title: title ?? firstHeading,
    body: body.length > 0 ? body : undefined,
    topics: topicLines ? readTopics(topicLines) : [],
  }
}

/** 图片名片文件名：原件名后面直接加 `.md`（`media/a.png` -> `media/a.png.md`） */
export function toImageCardSegments(mediaPath: string): string[] {
  const segments = parseRelPathRequired(mediaPath)
  const last = segments[segments.length - 1]!
  return [...segments.slice(0, -1), `${last}.md`]
}
