/**
 * AI 技能分区的纯计算：本地预校验、错误码到文案键的映射、技能目录的结构摘要。
 *
 * **本地校验不是安全边界。** 真正挡住坏包、越界路径、超限解压的是服务端，
 * 这里拦一遍只为了省一次往返、让人当场看到提示。服务端说不行就是不行。
 */

import {
  MAX_SKILL_ARCHIVE_BYTES,
  MAX_SKILL_FILE_BYTES,
  SKILL_ERROR_CODE,
} from '@/api/skills/skill.constants'

/** 技能入口文件名，必须在技能根目录 */
export const SKILL_ENTRY_FILE = 'SKILL.md'

/** 文件选择框的 accept：扩展名和 MIME 都给，不同系统的选择器认的不一样 */
export const SKILL_UPLOAD_ACCEPT = '.zip,.md,application/zip,text/markdown'

/**
 * 选中文件后本地先判一道：扩展名和大小。
 * 返回 settings 命名空间下的文案键；能传返回 null。
 *
 * - 扩展名只认 `.zip` / `.md`（不分大小写），其他一律 `fileInvalid`
 * - `.zip` 超 10 MiB、`.md` 超 64 KiB → `fileTooLarge`
 */
export function validateSkillFile(file: Pick<File, 'name' | 'size'>): string | null {
  const name = file.name.toLowerCase()

  let limit: number
  if (name.endsWith('.zip'))
    limit = MAX_SKILL_ARCHIVE_BYTES
  else if (name.endsWith('.md'))
    limit = MAX_SKILL_FILE_BYTES
  else
    return 'skills.error.fileInvalid'

  return file.size > limit ? 'skills.error.fileTooLarge' : null
}

/** 错误码 → settings 命名空间下的文案键。和 20900 段一一对应，不要凭印象加 */
const SKILL_ERROR_KEY_MAP: Record<number, string> = {
  [SKILL_ERROR_CODE.NameInvalid]: 'skills.error.nameInvalid',
  [SKILL_ERROR_CODE.NameReserved]: 'skills.error.nameReserved',
  [SKILL_ERROR_CODE.FrontmatterMissing]: 'skills.error.frontmatterMissing',
  [SKILL_ERROR_CODE.FileTooLarge]: 'skills.error.fileTooLarge',
  [SKILL_ERROR_CODE.FileInvalid]: 'skills.error.fileInvalid',
  [SKILL_ERROR_CODE.AlreadyExists]: 'skills.error.alreadyExists',
  [SKILL_ERROR_CODE.NotFound]: 'skills.error.notFound',
  [SKILL_ERROR_CODE.BuiltinReadonly]: 'skills.error.builtinReadonly',
  [SKILL_ERROR_CODE.StorageUnavailable]: 'skills.error.storageUnavailable',
  [SKILL_ERROR_CODE.ArchiveInvalid]: 'skills.error.archiveInvalid',
  [SKILL_ERROR_CODE.ArchiveTooLarge]: 'skills.error.archiveTooLarge',
  [SKILL_ERROR_CODE.EntryMissing]: 'skills.error.entryMissing',
}

/** 把服务端的业务码翻成文案键；认不出来的一律「没成功，再试一次」 */
export function getSkillErrorKey(code?: string | number | null): string {
  if (code === undefined || code === null)
    return 'skills.error.unknown'
  return SKILL_ERROR_KEY_MAP[Number(code)] ?? 'skills.error.unknown'
}

/** 一个第一段目录和它下面（含更深层）的文件数 */
export interface SkillDirCount {
  /** 目录名，不带结尾的 `/` */
  name: string
  count: number
}

/** 技能目录的结构摘要 */
export interface SkillFileSummary {
  /** 根目录下有没有 SKILL.md */
  hasEntry: boolean
  /** 按第一段目录分组计数，按目录名排序 */
  dirs: SkillDirCount[]
  /** 根目录下除 SKILL.md 以外的文件数 */
  rootOthers: number
  /** 计入摘要的文件总数（去重后，不含目录条目） */
  total: number
}

/**
 * 把 `files` 收成一行摘要要用的数：「SKILL.md · references/ 3 个 · scripts/ 1 个 · 其他 2 个」。
 *
 * 规则：
 * - 只按**第一段目录**分组，`references/a/b.md` 算在 `references` 下面
 * - 根目录下的 `SKILL.md`（大小写严格）单独标出来，不算「其他」
 * - 根目录下别的文件都算「其他」，包括 `skill.md`、`README.md`、`LICENSE`
 * - 空段忽略（`a//b`、开头的 `/`）；以 `/` 结尾的是目录条目，不算文件；重复的路径只算一次
 *
 * 服务端给的是已排序的 posix 路径，这里仍然自己排一次目录名，不依赖顺序。
 */
export function summarizeSkillFiles(files: readonly string[] | null | undefined): SkillFileSummary {
  const summary: SkillFileSummary = { hasEntry: false, dirs: [], rootOthers: 0, total: 0 }
  if (!files?.length)
    return summary

  const dirCounts = new Map<string, number>()

  for (const path of new Set(files)) {
    if (path.endsWith('/'))
      continue

    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0)
      continue

    summary.total += 1

    if (segments.length === 1) {
      if (segments[0] === SKILL_ENTRY_FILE)
        summary.hasEntry = true
      else
        summary.rootOthers += 1
      continue
    }

    const dir = segments[0]
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1)
  }

  summary.dirs = [...dirCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  return summary
}

/** 除了 SKILL.md 还有没有别的文件——只有一个 SKILL.md 时摘要就是全部，不用给展开 */
export function hasExtraSkillFiles(summary: SkillFileSummary): boolean {
  return summary.dirs.length > 0 || summary.rootOthers > 0
}
