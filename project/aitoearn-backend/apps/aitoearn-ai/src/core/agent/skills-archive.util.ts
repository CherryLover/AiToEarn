/**
 * 技能包（zip）解压
 *
 * 解压是这条链路上最容易出事的一环，下面每一种都有专门的一道：
 *
 * - **zip slip**（条目路径带 `../`、绝对路径、盘符、反斜杠，写到目录外面去）：
 *   条目名先过 `normalizeArchiveEntryPath`，统一成 posix 相对路径；拼出来的落点再 `path.resolve` 一次，
 *   必须还在解压目录里。yauzl 开了 `strictFileNames`，自己也会先挡一遍
 * - **软链条目**（先放一个指向 /etc 的软链，再往软链里写）：一个软链都不建，条目一律按普通文件写；
 *   unix mode 标着软链、设备、管道的条目直接拒
 * - **压缩炸弹 / 头部说谎**（10 MiB 的包解出几个 G；声明 1 KiB 实际解出 1 GiB）：
 *   大小按**实际解出来的字节数**累计（`ArchiveByteBudget`），超了立刻掐断流。
 *   zip 头里声明的大小只拿来提前拒掉老实的大包，从不拿来放行；yauzl 的 `validateEntrySizes`
 *   也会在实际字节数超过声明值的那一刻报错
 * - **条目撞名**（同名两份、`a` 既是文件又是目录）：先查一遍，写文件再用 `wx`（O_EXCL），不覆盖已写出的东西
 *
 * 选 yauzl 不选 fflate：yauzl 读中央目录、按条目流式解压、给得出 externalFileAttributes（判软链要用）；
 * fflate 的 `unzipSync` 一次把整包解进内存，也拿不到 unix mode。
 */

import type { Entry, ZipFile } from 'yauzl'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { fromBufferPromise } from 'yauzl'
import { SKILL_FILE_NAME } from './skill-init.service'

/** 上传的 zip 本身 */
export const MAX_SKILL_ARCHIVE_BYTES = 10 * 1024 * 1024
/** 解压后全部文件加起来 */
export const MAX_SKILL_UNPACKED_BYTES = 30 * 1024 * 1024
/** 解压出来的文件数（不含目录、`__MACOSX`、`.DS_Store`） */
export const MAX_SKILL_ARCHIVE_FILES = 500
/** 包里单个文件 */
export const MAX_SKILL_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024

/** 脚本放在这下面，落盘给 0755；其余一律 0644 */
const SCRIPTS_DIR_PREFIX = 'scripts/'
const SCRIPT_FILE_MODE = 0o755
const PLAIN_FILE_MODE = 0o644
const DIR_MODE = 0o755

/** unix mode 的文件类型位（`S_IFMT` 及其取值）。zip 里存的是 unix 的值，和宿主机平台无关，所以写死 */
const UNIX_TYPE_MASK = 0o170000
const UNIX_TYPE_FILE = 0o100000
const UNIX_TYPE_DIR = 0o040000

const MACOS_METADATA_DIR = '__MACOSX'
const MACOS_FINDER_FILE = '.DS_Store'
const DRIVE_LETTER = /^[a-z]:/i

const logger = new Logger('SkillArchive')

function hasControlChar(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0)
    return code < 0x20 || code === 0x7F
  })
}

/**
 * 把 zip 条目名统一成 posix 相对路径；不安全的一律返回 null。
 *
 * 拒：空名、NUL 及其他控制字符、反斜杠、以 `/` 开头、任何一段像盘符（`C:`）、任何一段是 `..`、中间有空段（`a//b`）。
 * `.` 段直接丢掉；结尾的 `/`（目录条目）去掉。只剩根目录本身（`./`）时返回空串，由调用方决定怎么处理。
 */
export function normalizeArchiveEntryPath(raw: string): string | null {
  if (raw.length === 0 || hasControlChar(raw) || raw.includes('\\') || raw.startsWith('/'))
    return null

  const body = raw.endsWith('/') ? raw.slice(0, -1) : raw
  const segments = body.split('/').filter(segment => segment !== '.')
  if (segments.some(segment => segment === '' || segment === '..' || DRIVE_LETTER.test(segment)))
    return null

  return segments.join('/')
}

/** macOS 打包顺手带进来的东西：`__MACOSX/` 下的资源分支、任意层级的 `.DS_Store`，直接当没看见 */
export function isIgnoredArchiveEntry(relPath: string): boolean {
  if (relPath === MACOS_METADATA_DIR || relPath.startsWith(`${MACOS_METADATA_DIR}/`))
    return true

  return path.posix.basename(relPath) === MACOS_FINDER_FILE
}

/** externalFileAttributes 的高 16 位是 unix mode（Info-ZIP 约定），取出其中的文件类型位；没设就是 0 */
export function readUnixFileType(externalFileAttributes: number): number {
  return (externalFileAttributes >>> 16) & UNIX_TYPE_MASK
}

/** 只认普通文件和目录；软链、设备、管道一律不安全。没设类型位（Windows 打的包）按普通条目处理 */
export function isUnsafeUnixFileType(type: number): boolean {
  return type !== 0 && type !== UNIX_TYPE_FILE && type !== UNIX_TYPE_DIR
}

/**
 * 认技能根目录，返回要从条目路径前面剥掉的前缀；认不出来返回 null。
 *
 * - `SKILL.md` 就在包根目录 → 包根就是技能根，前缀为空
 * - 所有文件都在同一个顶层文件夹下，且它里面有 `SKILL.md` → 剥掉这一层（Finder「压缩」出来就是这样）
 * - 其他情况（多个顶层文件夹、顶层混着散文件、哪都找不到 `SKILL.md`）→ null
 *
 * 只看文件：空文件夹不带内容，不参与判断。
 */
export function detectSkillRootPrefix(filePaths: readonly string[]): string | null {
  if (filePaths.includes(SKILL_FILE_NAME))
    return ''

  if (filePaths.length === 0 || filePaths.some(filePath => !filePath.includes('/')))
    return null

  const topLevel = new Set(filePaths.map(filePath => filePath.split('/')[0]))
  if (topLevel.size !== 1)
    return null

  const [folder] = topLevel
  return filePaths.includes(`${folder}/${SKILL_FILE_NAME}`) ? `${folder}/` : null
}

/** 同名两份，或者某个路径既是文件又是另一个文件的父目录 */
export function hasConflictingPaths(filePaths: readonly string[]): boolean {
  const unique = new Set(filePaths)
  if (unique.size !== filePaths.length)
    return true

  return filePaths.some((filePath) => {
    const segments = filePath.split('/')
    return segments.slice(0, -1).some((_, index) => unique.has(segments.slice(0, index + 1).join('/')))
  })
}

/** 相对技能根目录的路径 → 落盘权限 */
export function skillFileMode(relPath: string): number {
  return relPath.startsWith(SCRIPTS_DIR_PREFIX) ? SCRIPT_FILE_MODE : PLAIN_FILE_MODE
}

/**
 * 按实际解出来的字节数记账。每来一块数据就记一次，单文件或总量一超立刻抛 `SkillArchiveTooLarge`——
 * 抛出去的那一刻读流的循环就断了，后面的数据根本不会再解。
 */
export class ArchiveByteBudget {
  private totalBytes = 0
  private fileBytes = 0

  beginFile(): void {
    this.fileBytes = 0
  }

  consume(bytes: number): void {
    this.fileBytes += bytes
    this.totalBytes += bytes

    if (this.fileBytes > MAX_SKILL_ARCHIVE_FILE_BYTES || this.totalBytes > MAX_SKILL_UNPACKED_BYTES)
      throw new AppException(ResponseCode.SkillArchiveTooLarge)
  }
}

interface ArchiveFile {
  entry: Entry
  /** 规范化之后、剥前缀之前的路径 */
  path: string
}

function archiveInvalid(reason: string): AppException {
  logger.warn(`Rejected skill archive: ${reason}`)
  return new AppException(ResponseCode.SkillArchiveInvalid)
}

/**
 * 第一遍：只看中央目录，不解任何数据。
 * 每个条目（包括要忽略的）都要过路径和类型校验；文件数、声明大小超限在这一遍就拒。
 */
async function collectArchiveFiles(zipfile: ZipFile): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = []
  let declaredBytes = 0

  for await (const entry of zipfile.eachEntry()) {
    const relPath = normalizeArchiveEntryPath(entry.fileName)
    if (relPath === null)
      throw archiveInvalid(`unsafe entry path ${JSON.stringify(entry.fileName)}`)

    const unixType = readUnixFileType(entry.externalFileAttributes)
    if (isUnsafeUnixFileType(unixType))
      throw archiveInvalid(`entry is not a regular file or directory: ${relPath}`)

    const isDirectory = entry.fileName.endsWith('/') || unixType === UNIX_TYPE_DIR
    if (isDirectory || isIgnoredArchiveEntry(relPath))
      continue

    if (relPath === '')
      throw archiveInvalid('file entry without a name')

    if (!entry.canDecodeFileData())
      throw archiveInvalid(`entry is encrypted or uses an unsupported compression method: ${relPath}`)

    if (files.length >= MAX_SKILL_ARCHIVE_FILES)
      throw new AppException(ResponseCode.SkillArchiveTooLarge)

    declaredBytes += entry.uncompressedSize
    if (entry.uncompressedSize > MAX_SKILL_ARCHIVE_FILE_BYTES || declaredBytes > MAX_SKILL_UNPACKED_BYTES)
      throw new AppException(ResponseCode.SkillArchiveTooLarge)

    files.push({ entry, path: relPath })
  }

  if (hasConflictingPaths(files.map(file => file.path)))
    throw archiveInvalid('duplicate or conflicting entry paths')

  return files
}

/** 拼出来的落点必须还在解压目录里，这是 zip slip 的最后一道 */
function resolveInside(destDir: string, relPath: string): string {
  const base = path.resolve(destDir)
  const target = path.resolve(base, relPath)
  if (!target.startsWith(base + path.sep))
    throw archiveInvalid(`entry escapes the extraction dir: ${relPath}`)

  return target
}

/**
 * 解一个条目进内存，边解边记账。单文件上限 10 MiB，内存占用也就这么多。
 * 记账一抛异常，for-await 退出时会销毁读流，后面的数据不会再解。
 */
async function readEntryContent(zipfile: ZipFile, entry: Entry, budget: ArchiveByteBudget): Promise<Buffer> {
  budget.beginFile()
  const stream = await zipfile.openReadStreamPromise(entry)
  const chunks: Buffer[] = []

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    budget.consume(chunk.length)
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

/** 永远按普通文件写：`wx` 是 O_CREAT|O_EXCL，路径上已经有东西（含软链）就失败，不会顺着它写出去 */
async function writeExtractedFile(target: string, content: Buffer, mode: number): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: DIR_MODE })
    await fs.promises.writeFile(target, content, { flag: 'wx', mode })
    // writeFile 的 mode 会被 umask 削掉，再明确设一次
    await fs.promises.chmod(target, mode)
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // 大小写不敏感的盘上，`A.md` 和 `a.md` 会撞在一起——这是包的问题，不是盘的问题
    if (code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR')
      throw archiveInvalid(`conflicting entry ${target}`)

    logger.error(error as Error, `Failed to write extracted skill file ${target}`)
    throw new AppException(ResponseCode.SkillStorageUnavailable)
  }
}

async function extractFiles(zipfile: ZipFile, destDir: string): Promise<string[]> {
  const files = await collectArchiveFiles(zipfile)

  const prefix = detectSkillRootPrefix(files.map(file => file.path))
  if (prefix === null)
    throw new AppException(ResponseCode.SkillEntryMissing)

  const budget = new ArchiveByteBudget()
  const written: string[] = []
  for (const file of files) {
    const relPath = file.path.slice(prefix.length)
    const target = resolveInside(destDir, relPath)
    const content = await readEntryContent(zipfile, file.entry, budget)
    await writeExtractedFile(target, content, skillFileMode(relPath))
    written.push(relPath)
  }

  return written.sort()
}

/**
 * 把技能包解进 `destDir`（调用方建好的空临时目录），返回写出来的文件相对路径（相对技能根目录）。
 *
 * 只负责「安全地解出来」：`SKILL.md` 的内容校验、落到正式目录都是调用方的事。
 * 任何一步失败都直接抛，`destDir` 里写了一半的东西由调用方整个删掉。
 *
 * 错误码：包坏了 / 路径不安全 / 软链 → `SkillArchiveInvalid`；超上限 → `SkillArchiveTooLarge`；
 * 认不出技能根目录 → `SkillEntryMissing`；盘写不了 → `SkillStorageUnavailable`。
 */
export async function extractSkillArchive(buffer: Buffer, destDir: string): Promise<string[]> {
  let zipfile: ZipFile
  try {
    zipfile = await fromBufferPromise(buffer, {
      autoClose: false,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    })
  }
  catch (error) {
    throw archiveInvalid(`cannot open zip: ${(error as Error).message}`)
  }

  try {
    return await extractFiles(zipfile, destDir)
  }
  catch (error) {
    if (error instanceof AppException)
      throw error

    // yauzl 读条目、解数据时报的错（头部和实际字节数对不上、数据损坏、越界……）
    throw archiveInvalid((error as Error).message)
  }
  finally {
    zipfile.close()
  }
}
