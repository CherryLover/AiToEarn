/**
 * 自定义技能的校验口径
 *
 * 技能是**写给 AI 看的指令**，允许上传等于允许登录用户往 AI 的执行上下文里注入指令。
 * 这不是靠校验能消除的风险，只能把边界钉死：名字必须过白名单，落盘路径永远拿校验过的
 * 名字重新拼，绝不直接用上传来的文件名——见 `docs/rebuild/contract-custom-skills.md` 第七节。
 *
 * 纯函数，不碰文件系统，好测。
 */

import { BUILTIN_SKILL_NAMES } from './skill-init.service'

/** SKILL.md 上限（单独传 .md、包里的 SKILL.md 都是这个口径）。技能文档不该比这更大，更大的多半是传错了文件 */
export const MAX_SKILL_FILE_BYTES = 64 * 1024

/** 目录名规则，和项目英文名 / 方向 slug 一个口径 */
const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/

export interface SkillFrontmatter {
  name: string
  description: string
}

export type SkillParseFailure
  = | 'frontmatter_missing'
    | 'name_invalid'
    | 'name_reserved'

export type SkillParseResult
  = | { ok: true, meta: SkillFrontmatter }
    | { ok: false, reason: SkillParseFailure }

/** 名字单独拿出来判，删除接口也要用 */
export function isValidSkillName(name: string): boolean {
  if (!SKILL_NAME_PATTERN.test(name))
    return false

  // 连续连字符单独挡：正则里允许，但目录名里出现 `a--b` 只会让人看花眼
  return !name.includes('--')
}

export function isBuiltinSkillName(name: string): boolean {
  return (BUILTIN_SKILL_NAMES as readonly string[]).includes(name)
}

/** frontmatter 里一行 `key: value`，值两边的引号剥掉 */
function readFrontmatterField(block: string, key: string): string {
  const match = block.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'))
  if (!match)
    return ''

  return match[1].trim().replace(/^['"]|['"]$/g, '').trim()
}

/**
 * 只把 frontmatter 里的 name / description 抠出来，**不做任何校验**；没有 frontmatter 返回 null。
 * 列表展示用——内置技能的名字过不了上传校验（和内置重名），但它的 description 照样要显示。
 */
export function readSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match)
    return null

  return {
    name: readFrontmatterField(match[1], 'name'),
    description: readFrontmatterField(match[1], 'description'),
  }
}

/**
 * 从技能文件正文里解析 frontmatter，并按上传的口径校验。
 *
 * `description` 不是可有可无的：技能是**靠这句话被匹配到**的，
 * 空着等于传了一个永远不会触发的东西——那不是配置错误，是白传。
 */
export function parseSkillFile(content: string): SkillParseResult {
  const frontmatter = readSkillFrontmatter(content)
  if (!frontmatter)
    return { ok: false, reason: 'frontmatter_missing' }

  const { name, description } = frontmatter
  if (!name || !description)
    return { ok: false, reason: 'frontmatter_missing' }

  if (!isValidSkillName(name))
    return { ok: false, reason: 'name_invalid' }

  // 内置的必须赢：镜像升级加了新内置技能时，不能被一个旧的同名上传悄悄改掉行为
  if (isBuiltinSkillName(name))
    return { ok: false, reason: 'name_reserved' }

  return { ok: true, meta: { name, description } }
}

/** 列表里给人看的一行 */
export interface SkillSummary {
  name: string
  description: string
  /** 内置的只能看，自定义的能删 */
  builtin: boolean
  /** 自定义技能的最后修改时间；内置的没有 */
  updatedAt?: Date
  /** 技能根目录下所有文件的相对路径（posix 分隔、排序、含 SKILL.md，最多 500 条） */
  files: string[]
}
