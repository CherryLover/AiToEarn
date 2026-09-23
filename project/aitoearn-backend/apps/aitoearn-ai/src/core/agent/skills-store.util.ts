/**
 * 技能落盘：收一个上传（单个 .md 或技能包 .zip），原子地换进技能根目录；删一个技能。
 *
 * 原子的意思是：Agent 同步时要么看到旧的整包，要么看到新的整包，看不到解了一半的东西。做法——
 * 1. 先解 / 写进技能根目录下的 `.tmp-<随机>/`（同一个文件系统，rename 才是原子的）
 * 2. 整包校验通过、拿到 `SKILL.md` 里的 name 之后，rename 成 `<name>`
 * 3. 覆盖时先把旧目录 rename 成 `.trash-<随机>`，新的换上去以后再删 trash
 * 4. 任何一步失败，临时目录整个删掉
 *
 * 以 `.` 开头的目录在列表和同步里一律跳过（见 `isHiddenEntryName`），所以中间状态谁都看不见。
 *
 * 技能根目录由调用方传进来：正式跑是 `/data/skills`，测试是临时目录。
 */

import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { SKILL_FILE_NAME } from './skill-init.service'
import { extractSkillArchive, MAX_SKILL_ARCHIVE_BYTES } from './skills-archive.util'
import { isRegularFile, listFilesRecursive } from './skills-fs.util'
import { MAX_SKILL_FILE_BYTES, parseSkillFile, SkillFrontmatter } from './skills.util'

/** 列表里每个技能最多列这么多个文件，和解压的文件数上限一致 */
export const MAX_LISTED_SKILL_FILES = 500

const STAGING_PREFIX = '.tmp-'
const TRASH_PREFIX = '.trash-'
const SKILL_DIR_MODE = 0o755
const SKILL_FILE_MODE = 0o644

const logger = new Logger('SkillStore')

export type SkillUploadKind = 'markdown' | 'archive'

/** 按扩展名认上传的是什么；两样都不是返回 null */
export function detectSkillUploadKind(originalName: string): SkillUploadKind | null {
  const lower = originalName.toLowerCase()
  if (lower.endsWith('.md'))
    return 'markdown'
  if (lower.endsWith('.zip'))
    return 'archive'
  return null
}

export interface SkillUpload {
  buffer: Buffer
  originalName: string
}

export interface StoredSkill extends SkillFrontmatter {
  /** 技能根目录下所有文件的相对路径（posix、排序、含 SKILL.md） */
  files: string[]
}

/** `parseSkillFile` 的失败原因 → 错误码 */
function parseSkillOrThrow(content: string): SkillFrontmatter {
  const parsed = parseSkillFile(content)
  if (parsed.ok)
    return parsed.meta

  if (parsed.reason === 'name_invalid')
    throw new AppException(ResponseCode.SkillNameInvalid)
  if (parsed.reason === 'name_reserved')
    throw new AppException(ResponseCode.SkillNameReserved)
  throw new AppException(ResponseCode.SkillFrontmatterMissing)
}

function storageUnavailable(error: unknown, message: string): AppException {
  logger.error(error as Error, message)
  return new AppException(ResponseCode.SkillStorageUnavailable)
}

function randomHiddenPath(rootDir: string, prefix: string): string {
  return path.join(rootDir, `${prefix}${randomBytes(8).toString('hex')}`)
}

/** 临时目录：mkdtemp 建出来是 0700，换成正式目录前改成 0755，不然宿主机上别人读不了 */
async function createStagingDir(rootDir: string): Promise<string> {
  try {
    await fs.promises.mkdir(rootDir, { recursive: true })
    const stagingDir = await fs.promises.mkdtemp(path.join(rootDir, STAGING_PREFIX))
    await fs.promises.chmod(stagingDir, SKILL_DIR_MODE)
    return stagingDir
  }
  catch (error) {
    throw storageUnavailable(error, `Failed to create skill staging dir under ${rootDir}`)
  }
}

async function writeStagedSkillFile(stagingDir: string, buffer: Buffer): Promise<void> {
  const file = path.join(stagingDir, SKILL_FILE_NAME)
  try {
    await fs.promises.writeFile(file, buffer, { flag: 'wx', mode: SKILL_FILE_MODE })
    await fs.promises.chmod(file, SKILL_FILE_MODE)
  }
  catch (error) {
    throw storageUnavailable(error, `Failed to write ${file}`)
  }
}

/** 包里的 SKILL.md：大小和单独传 .md 一个口径，超了同样是 SkillFileTooLarge */
async function readStagedSkillMeta(stagingDir: string): Promise<SkillFrontmatter> {
  const file = path.join(stagingDir, SKILL_FILE_NAME)
  const stats = await fs.promises.lstat(file)
  if (stats.size > MAX_SKILL_FILE_BYTES)
    throw new AppException(ResponseCode.SkillFileTooLarge)

  return parseSkillOrThrow(await fs.promises.readFile(file, 'utf-8'))
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.lstat(target)
    return true
  }
  catch {
    return false
  }
}

/** 并发的两次上传抢同一个名字时，后到的那次 rename 会撞上已存在的非空目录 */
function isTargetTakenError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOTEMPTY' || code === 'EEXIST'
}

async function renameIntoPlace(stagingDir: string, target: string): Promise<void> {
  try {
    await fs.promises.rename(stagingDir, target)
  }
  catch (error) {
    if (isTargetTakenError(error))
      throw new AppException(ResponseCode.SkillAlreadyExists)
    throw storageUnavailable(error, `Failed to move ${stagingDir} to ${target}`)
  }
}

/** 旧目录挪去 trash，新的换上来；换失败就把旧的挪回来 */
async function swapIntoPlace(rootDir: string, stagingDir: string, target: string): Promise<void> {
  const trash = randomHiddenPath(rootDir, TRASH_PREFIX)
  try {
    await fs.promises.rename(target, trash)
  }
  catch (error) {
    throw storageUnavailable(error, `Failed to move old skill ${target} aside`)
  }

  try {
    await fs.promises.rename(stagingDir, target)
  }
  catch (error) {
    await fs.promises.rename(trash, target).catch((restoreError: Error) =>
      logger.error(restoreError, `Failed to restore old skill ${target} from ${trash}`))
    throw storageUnavailable(error, `Failed to move ${stagingDir} to ${target}`)
  }

  await fs.promises.rm(trash, { recursive: true, force: true }).catch((rmError: Error) =>
    logger.error(rmError, `Failed to remove old skill ${trash}`))
}

/**
 * 同名判断看的是 `<name>/SKILL.md` 在不在：只剩个空壳目录的（比如上次半路失败的残留）不算已存在，直接顶掉。
 */
async function installStagedSkill(rootDir: string, stagingDir: string, name: string, overwrite: boolean): Promise<string> {
  const target = path.join(rootDir, name)
  const exists = await pathExists(target)

  if (exists && !overwrite && isRegularFile(path.join(target, SKILL_FILE_NAME)))
    throw new AppException(ResponseCode.SkillAlreadyExists)

  if (exists)
    await swapIntoPlace(rootDir, stagingDir, target)
  else
    await renameIntoPlace(stagingDir, target)

  return target
}

/** 上传大小按类型分：.md 64 KiB，.zip 10 MiB */
function assertUploadSize(kind: SkillUploadKind, byteLength: number): void {
  const limit = kind === 'markdown' ? MAX_SKILL_FILE_BYTES : MAX_SKILL_ARCHIVE_BYTES
  if (byteLength > limit)
    throw new AppException(ResponseCode.SkillFileTooLarge)
}

/**
 * 收一个技能上传，落到 `<rootDir>/<name>/`。
 *
 * 技能名一律取 `SKILL.md` frontmatter 里的 `name`（过白名单、不许和内置重名），
 * 上传的文件名、包里的文件夹名一概不管；落盘路径拿校验过的 name 重新拼——这是挡路径穿越的那一道。
 *
 * 覆盖 = 整个目录换掉：旧包里有、新包里没有的文件不会留下。
 */
export async function storeSkillUpload(rootDir: string, upload: SkillUpload, overwrite: boolean): Promise<StoredSkill> {
  const kind = detectSkillUploadKind(upload.originalName)
  if (!kind)
    throw new AppException(ResponseCode.SkillFileInvalid)

  assertUploadSize(kind, upload.buffer.byteLength)

  // 单个 .md 先校验再碰盘，不合格的连临时目录都不用建
  if (kind === 'markdown')
    parseSkillOrThrow(upload.buffer.toString('utf-8'))

  const stagingDir = await createStagingDir(rootDir)
  try {
    if (kind === 'markdown')
      await writeStagedSkillFile(stagingDir, upload.buffer)
    else
      await extractSkillArchive(upload.buffer, stagingDir)

    const meta = await readStagedSkillMeta(stagingDir)
    const target = await installStagedSkill(rootDir, stagingDir, meta.name, overwrite)

    return { ...meta, files: listFilesRecursive(target, MAX_LISTED_SKILL_FILES) }
  }
  finally {
    // 已经 rename 走的话这里什么都删不到；没走成的，写了一半的东西整个清掉
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch((error: Error) =>
      logger.error(error, `Failed to clean up skill staging dir ${stagingDir}`))
  }
}

/**
 * 删掉 `<rootDir>/<name>`：先 rename 成 `.trash-*`（这一步是原子的，同步那边立刻就看不见它了），再慢慢删。
 * 不存在返回 false，由调用方决定报什么错。
 */
export async function removeStoredSkill(rootDir: string, name: string): Promise<boolean> {
  const target = path.join(rootDir, name)
  if (!(await pathExists(target)))
    return false

  const trash = randomHiddenPath(rootDir, TRASH_PREFIX)
  try {
    await fs.promises.rename(target, trash)
  }
  catch (error) {
    throw storageUnavailable(error, `Failed to delete skill ${name}`)
  }

  await fs.promises.rm(trash, { recursive: true, force: true }).catch((error: Error) =>
    logger.error(error, `Failed to remove deleted skill ${trash}`))
  return true
}
