/**
 * 草稿标签页工具函数
 * 只做纯计算：从目录树里认出草稿、拆 frontmatter、读血缘、找配图、拼生成用的提示词。
 * 草稿是文件不是表，所以这里对字段都留了余地：认不出来的就不显示，不报错。
 */

import type { FileNode } from '@/api/projects/project-file.types'
import { ProjectFileType } from '@/api/projects/project-file.types'
import {
  DRAFT_CONTENT_FILE,
  DRAFT_MEDIA_KEYS,
  DRAFT_META_FILE,
  DRAFT_TITLE_KEYS,
  DRAFT_TOPIC_KEYS,
  DRAFTS_DIR,
} from './drafts.constants'

/** frontmatter 的值：一行的当字符串，列表的当字符串数组 */
export type FrontMatterValue = string | string[]

export interface DraftItem {
  /** 草稿目录（或单文件草稿的文件路径），相对项目根，同时当列表的 key */
  path: string
  /** 列表上显示的名字 */
  name: string
  /** 正文文件路径，找不到为空串 */
  contentPath: string
  /** 血缘文件路径，没有为空串 */
  metaPath: string
  updatedAt: string
}

/** 草稿血缘，字段对齐 contract-stage2 的 meta.json */
export interface DraftMeta {
  projectName: string
  angleSlug: string
  platform: string
  sourceAssetPaths: string[]
  promptSnapshot: string
  model: string
  createdAt: string
  /** 认不出来的字段原样留着，血缘面板底部照原样列出来 */
  extra: Record<string, string>
}

export interface DraftContent {
  title: string
  topics: string[]
  /** 去掉 frontmatter 的正文 */
  body: string
  frontMatter: Record<string, FrontMatterValue>
}

/** 去掉包裹的引号 */
function unquote(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

/**
 * 拆 YAML front matter。
 * 只认这三种写法：`key: value`、`key: [a, b]`、`key:` 后面跟 `- a` 列表。
 * 够用即可，不引新依赖。
 */
export function parseFrontMatter(content: string): {
  data: Record<string, FrontMatterValue>
  body: string
} {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n'))
    return { data: {}, body: normalized }

  const end = normalized.indexOf('\n---', 3)
  if (end < 0)
    return { data: {}, body: normalized }

  const block = normalized.slice(4, end)
  const body = normalized.slice(end + 4).replace(/^\n+/, '')
  const data: Record<string, FrontMatterValue> = {}

  let currentListKey = ''

  block.split('\n').forEach((line) => {
    // `- xxx` 是上一行那个 key 的列表项，不用正则免得回溯
    const trimmed = line.trimStart()
    if (currentListKey && trimmed.startsWith('-')) {
      const list = data[currentListKey]
      const value = unquote(trimmed.slice(1))
      if (Array.isArray(list))
        list.push(value)
      else
        data[currentListKey] = [value]
      return
    }

    const index = line.indexOf(':')
    if (index <= 0)
      return

    const key = line.slice(0, index).trim()
    if (!key)
      return

    const rest = line.slice(index + 1).trim()

    if (!rest) {
      // `key:` 后面跟一串 `- xxx`
      currentListKey = key
      data[key] = []
      return
    }

    currentListKey = ''

    if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest
        .slice(1, -1)
        .split(',')
        .map(item => unquote(item))
        .filter(Boolean)
      return
    }

    data[key] = unquote(rest)
  })

  return { data, body }
}

/** frontmatter 的值统一成数组 */
function toList(value: FrontMatterValue | undefined): string[] {
  if (!value)
    return []
  if (Array.isArray(value))
    return value.filter(Boolean)

  return value
    .split(/[,，、\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * 解析草稿正文：frontmatter 里取标题和话题，剩下的当正文。
 */
export function parseDraftContent(raw: string): DraftContent {
  const { data, body } = parseFrontMatter(raw)

  const titleKey = DRAFT_TITLE_KEYS.find(key => typeof data[key] === 'string' && data[key])
  const topicKey = DRAFT_TOPIC_KEYS.find(key => data[key] !== undefined)

  return {
    title: titleKey ? String(data[titleKey]) : '',
    topics: topicKey ? toList(data[topicKey]) : [],
    body,
    frontMatter: data,
  }
}

/** 把 JSON 里的值弄成字符串，对象和数组就序列化，认不出来的丢掉 */
function toText(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  try {
    return JSON.stringify(value)
  }
  catch {
    return ''
  }
}

/**
 * 把 meta.json 读成对象，不是对象就当没有。
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null

  return parsed as Record<string, unknown>
}

/**
 * 解析 meta.json 的血缘信息，字段缺了就留空，不报错。
 * 认不出来的字段原样留在 extra 里，血缘面板照原样列出来。
 */
export function parseDraftMeta(record: Record<string, unknown>): DraftMeta {
  const known = new Set([
    'projectName',
    'angleSlug',
    'platform',
    'sourceAssetPaths',
    'promptSnapshot',
    'model',
    'createdAt',
  ])

  const extra: Record<string, string> = {}
  Object.keys(record).forEach((key) => {
    if (known.has(key))
      return
    const text = toText(record[key])
    if (text)
      extra[key] = text
  })

  const sourceAssetPaths = Array.isArray(record.sourceAssetPaths)
    ? record.sourceAssetPaths.map(item => toText(item)).filter(Boolean)
    : []

  return {
    projectName: toText(record.projectName),
    angleSlug: toText(record.angleSlug),
    platform: toText(record.platform),
    sourceAssetPaths,
    promptSnapshot: toText(record.promptSnapshot),
    model: toText(record.model),
    createdAt: toText(record.createdAt),
    extra,
  }
}

/**
 * 从 drafts 目录树里认草稿。
 * 标准结构是一个草稿一个目录（里面 content.md + meta.json），
 * 顺手也认直接躺在 drafts/ 下的 .md 文件，免得 AI 换了写法页面就空白。
 */
export function collectDrafts(draftsNode: FileNode | null): DraftItem[] {
  if (!draftsNode?.children)
    return []

  const items: DraftItem[] = []

  draftsNode.children.forEach((child) => {
    if (child.type === ProjectFileType.Dir) {
      const files = child.children ?? []
      const content = files.find(file => file.name === DRAFT_CONTENT_FILE)
        ?? files.find(file => file.type === ProjectFileType.File && file.name.endsWith('.md'))
      const meta = files.find(file => file.name === DRAFT_META_FILE)

      items.push({
        path: child.path,
        name: child.name,
        contentPath: content?.path ?? '',
        metaPath: meta?.path ?? '',
        updatedAt: content?.updatedAt || child.updatedAt,
      })
      return
    }

    if (child.name.endsWith('.md')) {
      items.push({
        path: child.path,
        name: child.name.replace(/\.md$/, ''),
        contentPath: child.path,
        metaPath: '',
        updatedAt: child.updatedAt,
      })
    }
  })

  // 目录名以日期开头，按名字倒序就是新的在前；名字一样再看修改时间
  return items.sort(
    (a, b) => b.name.localeCompare(a.name) || b.updatedAt.localeCompare(a.updatedAt),
  )
}

/** 是不是外链 */
export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * 找出草稿要用的配图。
 * 三个来源都看：meta.json 的媒体字段、正文 frontmatter 的媒体字段、正文里的 markdown 图片。
 * 返回的是原始引用（OSS 外链或相对项目根的路径），去重后按出现顺序排。
 */
export function collectDraftImageRefs(
  content: DraftContent | null,
  metaRaw: Record<string, unknown> | null,
  draftDir: string,
): string[] {
  const refs: string[] = []

  const push = (value: string) => {
    const item = value.trim()
    if (!item || refs.includes(item))
      return
    refs.push(item)
  }

  DRAFT_MEDIA_KEYS.forEach((key) => {
    const fromMeta = metaRaw?.[key]
    if (Array.isArray(fromMeta))
      fromMeta.forEach(item => typeof item === 'string' && push(item))
    else if (typeof fromMeta === 'string')
      push(fromMeta)

    const fromFront = content?.frontMatter[key]
    if (Array.isArray(fromFront))
      fromFront.forEach(item => push(item))
    else if (typeof fromFront === 'string')
      push(fromFront)
  })

  // 正文里的 ![](xxx)
  const body = content?.body ?? ''
  const pattern = /!\[[^\]]*\]\(([^)\s]+)/g
  let match = pattern.exec(body)
  while (match) {
    push(match[1])
    match = pattern.exec(body)
  }

  // 草稿目录里写的相对路径，补成相对项目根的路径
  return refs.map((ref) => {
    if (isRemoteUrl(ref) || ref.startsWith(`${DRAFTS_DIR}/`) || ref.startsWith('media/'))
      return ref
    if (ref.startsWith('./'))
      return `${draftDir}/${ref.slice(2)}`
    if (ref.startsWith('/'))
      return ref.slice(1)
    return ref
  })
}

/**
 * 「按这个方向生成一条内容」的提示词。
 * 技能靠描述匹配触发，这里把技能名、方向、平台和落盘位置都写明。
 */
export function buildDraftPrompt(params: {
  projectName: string
  angleSlug: string
  angleName: string
  platform: string
  extra?: string
}): string {
  const lines = [
    `请用 drafting-post 技能，为项目 ${params.projectName} 生成一条可以直接发的内容。`,
    `方向：${params.angleName}（angles/${params.angleSlug}.md）。`,
    `目标平台：${params.platform}，按这个平台的规则来写。`,
    '先读 CLAUDE.md 和这个方向的写作指引，再读相关的 background/ 物料，事实只能来自物料。',
    `写进 drafts/<yyyy-MM-dd>-${params.platform}-${params.angleSlug}/，正文放 ${DRAFT_CONTENT_FILE}（frontmatter 带标题和话题），血缘放 ${DRAFT_META_FILE}。`,
  ]

  if (params.extra?.trim())
    lines.push(`补充要求：${params.extra.trim()}`)

  return lines.join('\n')
}
