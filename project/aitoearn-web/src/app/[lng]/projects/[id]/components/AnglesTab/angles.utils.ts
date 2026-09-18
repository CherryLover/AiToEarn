/**
 * 方向标签页工具函数
 * 只做纯计算：slug 校验、错误码翻译、按血统组树、按状态分组、AI 提炼的提示词。
 */

import type { Angle, AngleTreeNode } from '@/api/angles/angle.types'
import {
  ANGLE_DESC_MAX_LENGTH,
  ANGLE_ERROR_CODE,
  ANGLE_NAME_MAX_LENGTH,
  ANGLE_SLUG_MAX_LENGTH,
  ANGLE_SLUG_MIN_LENGTH,
  ANGLE_SLUG_RESERVED_WORDS,
} from '@/api/angles/angle.constants'
import { AngleStatus } from '@/api/angles/angle.types'
import { getProjectErrorKey } from '../../../projects.utils'

/** 只允许小写字母、数字、连字符 */
const ALLOWED_CHARS_PATTERN = /^[a-z0-9-]+$/

/** 判断口径与服务端一致：忽略大小写，另外 `_` / `.` 开头的一律算保留字 */
function isReservedSlug(slug: string): boolean {
  const lower = slug.toLowerCase()
  if (lower.startsWith('_') || lower.startsWith('.'))
    return true

  return (ANGLE_SLUG_RESERVED_WORDS as readonly string[]).includes(lower)
}

/**
 * 校验方向 slug，返回 projects 命名空间下的文案键；合法时返回 null。
 * 规则同项目英文名，顺序也保持一致，免得两边给出的拒绝理由对不上。
 */
export function validateAngleSlug(raw: string): string | null {
  const slug = raw.trim()

  if (!slug)
    return 'angles.slugError.required'

  if (isReservedSlug(slug))
    return 'angles.slugError.reserved'

  if (!ALLOWED_CHARS_PATTERN.test(slug))
    return 'angles.slugError.charset'

  if (!/^[a-z]/.test(slug))
    return 'angles.slugError.start'

  if (!/[a-z0-9]$/.test(slug))
    return 'angles.slugError.end'

  if (slug.length < ANGLE_SLUG_MIN_LENGTH || slug.length > ANGLE_SLUG_MAX_LENGTH)
    return 'angles.slugError.length'

  if (slug.includes('--'))
    return 'angles.slugError.doubleHyphen'

  return null
}

/**
 * 校验方向显示名，返回文案键；合法时返回 null。
 */
export function validateAngleName(raw: string): string | null {
  const name = raw.trim()

  if (!name)
    return 'angles.nameError.required'

  if (name.length > ANGLE_NAME_MAX_LENGTH)
    return 'angles.nameError.tooLong'

  return null
}

/**
 * 校验方向说明，返回文案键；合法时返回 null。
 */
export function validateAngleDesc(raw: string): string | null {
  if (raw.trim().length > ANGLE_DESC_MAX_LENGTH)
    return 'angles.descError.tooLong'

  return null
}

/**
 * 把服务端错误码翻成 projects 命名空间下的文案键。
 * 20200 段是方向自己的，其余（项目、物料文件、网络）交给 getProjectErrorKey。
 */
export function getAngleErrorKey(code?: string | number | null): string {
  if (code === undefined || code === null)
    return 'error.network'

  switch (Number(code)) {
    case ANGLE_ERROR_CODE.NotFound:
      return 'angles.error.notFound'
    case ANGLE_ERROR_CODE.SlugInvalid:
      return 'angles.error.slugInvalid'
    case ANGLE_ERROR_CODE.SlugTaken:
      return 'angles.error.slugTaken'
    case ANGLE_ERROR_CODE.SlugReserved:
      return 'angles.error.slugReserved'
    case ANGLE_ERROR_CODE.ParentNotFound:
      return 'angles.error.parentNotFound'
    case ANGLE_ERROR_CODE.ParentSelf:
      return 'angles.error.parentSelf'
    case ANGLE_ERROR_CODE.ParentCycle:
      return 'angles.error.parentCycle'
    case ANGLE_ERROR_CODE.ParentProjectMismatch:
      return 'angles.error.parentProjectMismatch'
    case ANGLE_ERROR_CODE.Retired:
      return 'angles.error.retired'
    case ANGLE_ERROR_CODE.StatusInvalid:
      return 'angles.error.statusInvalid'
    case ANGLE_ERROR_CODE.DepthExceeded:
      return 'angles.error.depthExceeded'
    case ANGLE_ERROR_CODE.HasChildren:
      return 'angles.error.hasChildren'
    case ANGLE_ERROR_CODE.ProjectMismatch:
      return 'angles.error.projectMismatch'
    case ANGLE_ERROR_CODE.FileNotFound:
      return 'angles.error.fileNotFound'
    case ANGLE_ERROR_CODE.FileWriteFailed:
      return 'angles.error.fileWriteFailed'
    case ANGLE_ERROR_CODE.FileRenameFailed:
      return 'angles.error.fileRenameFailed'
    case ANGLE_ERROR_CODE.FileDeleteFailed:
      return 'angles.error.fileDeleteFailed'
    case ANGLE_ERROR_CODE.FileInvalid:
      return 'angles.error.fileInvalid'
    case ANGLE_ERROR_CODE.ExtractionFailed:
      return 'angles.error.extractionFailed'
    case ANGLE_ERROR_CODE.DraftNotFound:
      return 'angles.error.draftNotFound'
    case ANGLE_ERROR_CODE.DraftGenerateFailed:
      return 'angles.error.draftGenerateFailed'
    case ANGLE_ERROR_CODE.DraftWriteFailed:
      return 'angles.error.draftWriteFailed'
    case ANGLE_ERROR_CODE.DraftMetaInvalid:
      return 'angles.error.draftMetaInvalid'
    case ANGLE_ERROR_CODE.PlatformNotSupported:
      return 'angles.error.platformNotSupported'
    default:
      return getProjectErrorKey(code)
  }
}

/**
 * 按 parentAngleId 组成方向演进树。
 * 父方向不在列表里（被筛掉或已被删）的当成顶层，成环的那几个也兜到顶层，
 * 保证任何一条数据都看得见，不会因为血统有问题就凭空消失。
 */
export function buildAngleTree(angles: Angle[]): AngleTreeNode[] {
  const nodes = new Map<string, AngleTreeNode>()
  angles.forEach(angle => nodes.set(angle.id, { ...angle, children: [] }))

  const roots: AngleTreeNode[] = []

  nodes.forEach((node) => {
    const parentId = node.parentAngleId
    const parent = parentId ? nodes.get(parentId) : undefined

    if (!parent || parent.id === node.id || isDescendant(nodes, node.id, parent.id)) {
      roots.push(node)
      return
    }

    parent.children.push(node)
  })

  const sortNodes = (list: AngleTreeNode[]) => {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.slug.localeCompare(b.slug))
    list.forEach(item => sortNodes(item.children))
  }
  sortNodes(roots)

  return roots
}

/** candidate 是不是 ancestor 的后代，用来挡住成环的血统 */
function isDescendant(
  nodes: Map<string, AngleTreeNode>,
  ancestorId: string,
  candidateId: string,
): boolean {
  let current = nodes.get(candidateId)
  const seen = new Set<string>()

  while (current) {
    if (current.id === ancestorId)
      return true
    if (seen.has(current.id))
      return false

    seen.add(current.id)
    current = current.parentAngleId ? nodes.get(current.parentAngleId) : undefined
  }

  return false
}

/**
 * 树上一共多少个节点。
 */
export function countAngleTree(nodes: AngleTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countAngleTree(node.children), 0)
}

/**
 * 按状态分组，顺序由调用方按 ANGLE_STATUS_ORDER 决定。
 */
export function groupAnglesByStatus(angles: Angle[]): Record<AngleStatus, Angle[]> {
  const groups: Record<AngleStatus, Angle[]> = {
    [AngleStatus.Candidate]: [],
    [AngleStatus.Testing]: [],
    [AngleStatus.Effective]: [],
    [AngleStatus.Retired]: [],
  }

  angles.forEach((angle) => {
    if (groups[angle.status])
      groups[angle.status].push(angle)
    else
      groups[AngleStatus.Candidate].push(angle)
  })

  return groups
}

/**
 * 派生子方向时给个不撞车的 slug 建议：父 slug 后面挂序号。
 * 超长就从父 slug 截一段，保证还能通过校验。
 */
export function suggestChildSlug(parentSlug: string, takenSlugs: string[]): string {
  const taken = new Set(takenSlugs)

  for (let index = 2; index < 100; index++) {
    const suffix = `-${index}`
    const base = parentSlug.slice(0, ANGLE_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')
    const candidate = `${base}${suffix}`
    if (!taken.has(candidate) && !validateAngleSlug(candidate))
      return candidate
  }

  return ''
}

/**
 * 「让 AI 提炼方向」的提示词。
 * 技能是靠描述匹配触发的，所以这里把技能名、物料范围和铁律都写明，
 * 免得 Agent 跑去凭空编方向。
 */
export function buildExtractAnglesPrompt(projectName: string, existingSlugs: string[]): string {
  const lines = [
    `请用 extracting-angles 技能，为项目 ${projectName} 提炼候选发布方向。`,
    '读 background/ 下的全部物料，提炼 3~6 个候选方向，每个说清楚切什么痛点、用什么噱头、面向谁。',
    '事实只能来自 background/ 里的材料，缺材料就直说缺，不要编。',
    '每个方向写成 angles/<slug>.md，frontmatter 里带上 slug、name、source、parent、status 和来源物料路径。',
  ]

  if (existingSlugs.length > 0)
    lines.push(`已经有这些方向，不要重复提：${existingSlugs.join('、')}。`)

  return lines.join('\n')
}
