import type { FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 从项目物料目录里认出「这一轮新生成的草稿」，只为拼一条推送文案用。
 *
 * 为什么要读文件：草稿不进数据库（contract-core 第五节，正文以文件为准），
 * AI 服务手上只有项目英文名，方向、平台、标题都只能从草稿目录里读。
 *
 * 全程只读、全程容错：读不到就返回 null，调用方当作「这轮没出草稿」处理，不推送。
 *
 * 路径安全：AI 服务 import 不到 aitoearn-server 的 `safe-fs`（是另一个应用的代码），
 * 所以这里照 contract-core 第四节的同一套做法自证，规模小得多：
 * 1. 目录项只认 `readdir(withFileTypes)` 给出的真目录，软链的 `isDirectory()` 是 false，直接跳过；
 * 2. 取 mtime 用 `lstat`（不跟随软链），不给「readdir 之后被换成软链」留窗口；
 * 3. 读文件走 `open(O_NOFOLLOW)` 再基于句柄 `stat` / `readFile`，不是「先查后用」；
 * 4. 调用方还可以传 `assertInside`（AI 服务的 `ProjectWorkspaceService.assertPathInsideProject`），
 *    在每次落盘访问前把真实落点再校验一遍。
 */

/** 草稿放在项目目录下的这一层 */
const DRAFTS_DIR = 'drafts'

/** frontmatter / meta.json 都很小，超过这个大小就不是我们写的，别读进内存 */
const MAX_READ_BYTES = 256 * 1024

/** 一轮最多看这么多个候选目录，防止目录里堆了几千份草稿时白扫一遍 */
const MAX_CANDIDATES = 50

/** 部分平台没有这个常量（Windows），退化成 0 不会让行为更宽松，只是少一层保险 */
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0

/** 额外的路径校验钩子：越界就抛异常，抛了就当这个路径读不到 */
export type PathGuard = (absolutePath: string) => void

export interface DraftScanOptions {
  /** 一般传 `ProjectWorkspaceService.assertPathInsideProject` 的绑定版本 */
  assertInside?: PathGuard
}

export interface DraftSummary {
  /** 草稿目录名，如 `2026-09-18-xhs-pain-point` */
  dirName: string
  /** content.md frontmatter 里的标题 */
  title?: string
  /** meta.json 里的方向 slug */
  angle?: string
  /** meta.json 里的平台代码，平台中立的草稿是空 */
  platform?: string
  /** 这一轮一共有几个草稿目录是新的 */
  count: number
}

/** 取 frontmatter 里某个字段的值。只认最朴素的 `key: value`，取不到就当没有 */
function readFrontmatterField(text: string, field: string): string | undefined {
  if (!text.startsWith('---'))
    return undefined

  const end = text.indexOf('\n---', 3)
  const frontmatter = end === -1 ? text : text.slice(0, end)

  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([a-z_][\w-]*):(.*)$/i)
    if (!match || match[1] !== field)
      continue

    const value = match[2].trim().replace(/^['"]|['"]$/g, '').trim()
    return value.length > 0 ? value : undefined
  }

  return undefined
}

/**
 * 读一个小文本文件，读不到就返回 undefined。
 *
 * `O_NOFOLLOW` 让「最后一段是软链」直接报错（ELOOP），软链指向项目外的 content.md
 * 拿不到句柄，也就进不了推送正文；大小和类型都基于句柄判断，判完立刻用同一个句柄读，
 * 中间没有第二次按路径解析。
 */
async function readTextCapped(path: string, guard?: PathGuard): Promise<string | undefined> {
  let handle: FileHandle | undefined
  try {
    guard?.(path)

    handle = await open(path, constants.O_RDONLY | O_NOFOLLOW)
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_READ_BYTES)
      return undefined

    return await handle.readFile('utf8')
  }
  catch {
    return undefined
  }
  finally {
    await handle?.close().catch(() => undefined)
  }
}

function readStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null)
    return undefined

  const raw = (value as Record<string, unknown>)[field]
  if (typeof raw !== 'string')
    return undefined

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * 找出 `since` 之后动过的草稿目录，返回最新的那个的概要。
 *
 * `since` 用任务开始的时间：只有这一轮真的写出草稿才推送。
 * 提炼方向、闲聊这类同样带 projectName 的任务不会误报。
 */
export async function findDraftWrittenSince(
  projectDir: string,
  since: Date,
  options: DraftScanOptions = {},
): Promise<DraftSummary | null> {
  const guard = options.assertInside
  try {
    const draftsDir = join(projectDir, DRAFTS_DIR)
    guard?.(draftsDir)

    const entries = await readdir(draftsDir, { withFileTypes: true })

    const fresh: Array<{ name: string, mtimeMs: number }> = []
    for (const entry of entries.slice(0, MAX_CANDIDATES)) {
      // dirent 的类型来自 readdir 本身，不跟随软链：指向外面的软链目录这里就是 false
      if (!entry.isDirectory() || entry.name.startsWith('.'))
        continue

      try {
        const candidate = join(draftsDir, entry.name)
        guard?.(candidate)

        // lstat 不跟随软链：readdir 之后被换成软链的，这里 isDirectory() 是 false
        const info = await lstat(candidate)
        if (info.isDirectory() && info.mtimeMs >= since.getTime())
          fresh.push({ name: entry.name, mtimeMs: info.mtimeMs })
      }
      catch {
        // 单个目录读不到就跳过，不影响其它的
      }
    }

    if (fresh.length === 0)
      return null

    fresh.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const newest = fresh[0].name
    const draftDir = join(draftsDir, newest)

    const summary: DraftSummary = { dirName: newest, count: fresh.length }

    const content = await readTextCapped(join(draftDir, 'content.md'), guard)
    if (content) {
      summary.title = readFrontmatterField(content, 'title')
      summary.platform = readFrontmatterField(content, 'platform')
      summary.angle = readFrontmatterField(content, 'angle')
    }

    const metaText = await readTextCapped(join(draftDir, 'meta.json'), guard)
    if (metaText) {
      try {
        const meta: unknown = JSON.parse(metaText)
        summary.angle = readStringField(meta, 'angleSlug') ?? summary.angle
        summary.platform = readStringField(meta, 'platform') ?? summary.platform
      }
      catch {
        // meta.json 写坏了不影响推送，标题和平台还能从 content.md 拿到
      }
    }

    return summary
  }
  catch {
    // drafts/ 不存在、没权限、目录被换掉、越界被挡……一律当作「这轮没出草稿」
    return null
  }
}
