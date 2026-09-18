import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import {
  close as closeCb,
  closeSync,
  constants,
  fstat as fstatCb,
  fstatSync,
  ftruncate as ftruncateCb,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  write as writeCb,
} from 'node:fs'
import { lstat, open, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { Logger } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'

/**
 * 物料目录的读写底座。
 *
 * 为什么不直接用 `resolveProjectPath` + `writeFile`：那是「先查后用」，
 * 校验和真正落盘之间隔着一个可被利用的时间窗口（contract-core.md 第四节，实测 4 次 4 中）。
 * 这里换成「基于句柄 / 基于目录本身操作 + 前后双向校验」：
 *
 * 1. 从根目录逐级下钻，每一级都 `lstat` 确认不是软链，再用 `O_NOFOLLOW | O_DIRECTORY` 打开，
 *    并把句柄一直握到操作结束；
 * 2. 每打开一级就记下它的 `dev`/`ino`，操作前后各做一次全链校验：
 *    把每一级路径重新 `lstat` 一遍，要求「不是软链」且「inode 和握着的句柄一致」；
 * 3. 读取通过句柄完成（`handle.read` / `handle.readFile` / `handle.createReadStream`），
 *    不再拿路径字符串二次访问；
 * 4. **所有会改动磁盘的动作（新建文件、建目录、改名、删除、列目录）都在 `withLockedCwd` 里做**，
 *    详见下面那段注释：靠 POSIX 的 cwd 语义顶替 Node 没暴露的 `openat`，
 *    这样父目录那一段不会被重新解析，也就没法在校验之后被换成软链把落点带出根目录。
 *
 * 根目录自己是软链是服务器上的常见部署方式（阶段 0 已有用例），属于合法场景，
 * 所以第 0 级按「跟随软链 + 比对 stat」处理，只有根以下的层级才禁止软链。
 *
 * 残留边界（写在这里免得下一个人以为它是万能的）：
 * - 跨目录改名只能把「落点」焊死（目标一定落在校验过的目录里），源那一侧仍然是按路径解析的，
 *   极窄的窗口里有可能把根目录外的文件搬进来——方向是「进来」不是「出去」，且源还要先过 `lstat` 不是软链这关；
 * - 整棵树被外部进程连根 `rename` 搬走时，我们握着的目录还是同一个 inode，写入会落在被搬走的那棵树里。
 * 真正的隔离仍然是三层：容器只挂 `projects`、Agent 工作目录锁死、这里的应用层校验。
 */

const logger = new Logger('SafeFs')

/** 部分平台没有这两个常量（Windows），退化成 0 不会让行为变得更宽松，只是少一层保险 */
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0
const O_DIRECTORY = constants.O_DIRECTORY ?? 0

/** 碰到软链时 open 的报错码，各平台不一样 */
const SYMLINK_ERROR_CODES = new Set(['ELOOP', 'EMLINK', 'EFTYPE'])

/** 路径不在了的报错码，按「找不到」处理而不是按事故处理 */
const MISSING_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR'])

/** 进程启动时的工作目录：`withLockedCwd` 恢复现场时的兜底值 */
const INITIAL_CWD = process.cwd()

const fstatAsync = promisify(fstatCb)
const ftruncateAsync = promisify(ftruncateCb)
const closeAsync = promisify(closeCb)
const writeAsync = promisify(writeCb) as (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
) => Promise<{ bytesWritten: number }>

export interface SafeEntryStat {
  name: string
  /** 相对项目物料根的路径，`/` 分隔 */
  relPath: string
  type: 'dir' | 'file'
  size: number | null
  updatedAt: Date
}

interface ChainLink {
  abs: string
  handle: FileHandle
  dev: number
  ino: number
  /** 根目录允许自己是软链，所以它按 stat（跟随）校验，其余按 lstat（不跟随） */
  followed: boolean
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

/**
 * 把底层 errno 翻译成业务错误码。
 * 翻译不了的落到 `fallback`：下钻阶段用「路径越界」（证明不了安全就不放行），
 * 真正动手那一步用调用方给的码（磁盘报错不该说成越界）。
 */
function mapOpenError(
  error: unknown,
  target: string,
  fallback: ResponseCode = ResponseCode.ProjectPathEscape,
): AppException {
  if (error instanceof AppException)
    return error

  const code = errorCode(error)

  if (code && SYMLINK_ERROR_CODES.has(code))
    return new AppException(ResponseCode.ProjectFileIsSymlink)

  if (code === 'ENOENT')
    return new AppException(ResponseCode.ProjectFileNotFound)

  if (code === 'ENOTDIR' || code === 'EISDIR' || code === 'ENAMETOOLONG')
    return new AppException(ResponseCode.ProjectFilePathInvalid)

  logger.error(`打开路径失败: ${target}`, error instanceof Error ? error.stack : String(error))
  return new AppException(fallback)
}

/**
 * 每一段自己再校验一遍，不依赖调用方先跑过 `parseRelPath`。
 * `path.join` 会把 `..` 静悄悄折叠掉，少校验一次就等于把安全边界托付给「以后每个调用方都记得过滤」。
 */
function assertSegment(segment: string): void {
  if (typeof segment !== 'string' || segment.length === 0)
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  if (segment === '.' || segment === '..')
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  if (segment.includes('/') || segment.includes('\\') || segment.includes('\0'))
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  if (path.isAbsolute(segment))
    throw new AppException(ResponseCode.ProjectFilePathInvalid)
}

function assertSegments(segments: string[]): void {
  for (const segment of segments)
    assertSegment(segment)
}

/**
 * Node 没有暴露 `openat`：按路径调用的 `open` / `mkdir` / `rename` / `unlink` 每次都会把
 * 父目录那一段重新解析一遍，校验之后被换成软链就会落到根目录外面去。
 *
 * 这里用 POSIX 的 cwd 语义把这个缺口补上：`chdir` 记住的是目录本身（内核里的 vnode），
 * 不是路径字符串，之后的相对路径由内核从这个目录开始解析，攻击方再怎么调换路径上的某一段都改不了落点。
 *
 * 三条铁规矩：
 * 1. **回调必须是同步的**。进程级 cwd 是全局的，中途一旦 `await`，别的请求就可能看见被改过的 cwd；
 *    同步回调期间没有任何别的 JS 能插进来（本仓库也没有任何按相对路径发起的异步文件操作）。
 * 2. `chdir` 之后立刻 `statSync('.')` 和握着的目录句柄比 `dev`/`ino`，确认真的进到了校验过的那个目录；
 *    对不上说明这一段在这一瞬被掉包了，什么都不做直接拒绝。
 * 3. 回调里只许用相对文件名，一旦拼绝对路径就等于把上面两条作废。
 */
function withLockedCwd<T>(dir: ChainLink, run: () => T): T {
  if (typeof process.chdir !== 'function') {
    // worker 线程里没有 chdir。证明不了安全就不动手（fail closed）
    logger.error('当前运行环境不支持 process.chdir，无法安全地改动物料目录')
    throw new AppException(ResponseCode.ProjectFileWriteFailed)
  }

  let previous = INITIAL_CWD
  try {
    previous = process.cwd()
  }
  catch {
    // 当前工作目录被删了之类，回头恢复到进程启动时的目录
  }

  try {
    process.chdir(dir.abs)
  }
  catch (error) {
    throw mapOpenError(error, dir.abs)
  }

  try {
    const here = statSync('.')
    if (here.dev !== dir.dev || here.ino !== dir.ino) {
      logger.error(`目录在操作期间被掉包，已拒绝: ${dir.abs}`)
      throw new AppException(ResponseCode.ProjectPathEscape)
    }

    return run()
  }
  finally {
    try {
      process.chdir(previous)
    }
    catch (error) {
      logger.error(`恢复工作目录失败: ${previous}`, error instanceof Error ? error.stack : String(error))
    }
  }
}

async function closeChain(links: ChainLink[]): Promise<void> {
  for (const link of [...links].reverse()) {
    try {
      await link.handle.close()
    }
    catch {
      // 关句柄失败不影响结论，忽略
    }
  }
}

/**
 * 从根目录逐级下钻，返回一路握着的目录句柄。
 * 调用方用完必须 `closeChain`，否则句柄泄漏。
 */
async function openChain(root: string, segments: string[]): Promise<ChainLink[]> {
  assertSegments(segments)

  const links: ChainLink[] = []

  try {
    // 根目录允许是软链：它来自配置，不是用户输入
    const rootHandle = await open(root, constants.O_RDONLY | O_DIRECTORY)
    const rootStat = await rootHandle.stat()
    links.push({ abs: root, handle: rootHandle, dev: rootStat.dev, ino: rootStat.ino, followed: true })

    let abs = root
    for (const segment of segments) {
      abs = path.join(abs, segment)

      // 先看一眼是不是软链，好给出准确的错误码；O_NOFOLLOW 才是防竞态的那道
      const entry = await lstat(abs)
      if (entry.isSymbolicLink())
        throw new AppException(ResponseCode.ProjectFileIsSymlink)
      if (!entry.isDirectory())
        throw new AppException(ResponseCode.ProjectFilePathInvalid)

      const handle = await open(abs, constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
      const dirStat = await handle.stat()
      links.push({ abs, handle, dev: dirStat.dev, ino: dirStat.ino, followed: false })
    }

    // 下钻是一级一级来的，期间上层可能被掉包。回头把整条链再验一遍，
    // 验过之后才把句柄交出去，调用方动手前拿到的就是一条已经自洽的链。
    await verifyChain(links)

    return links
  }
  catch (error) {
    await closeChain(links)
    if (error instanceof AppException)
      throw error

    throw mapOpenError(error, path.join(root, ...segments))
  }
}

/** 单级校验的判定，异步和同步两版共用 */
function assertLinkMatches(link: ChainLink, current: Stats): void {
  if (!link.followed && current.isSymbolicLink())
    throw new AppException(ResponseCode.ProjectFileIsSymlink)

  if (current.dev !== link.dev || current.ino !== link.ino) {
    logger.error(`路径在操作期间被掉包，已拒绝: ${link.abs}`)
    throw new AppException(ResponseCode.ProjectPathEscape)
  }
}

/** 校验途中读不到这一级：证明不了安全，一律拒绝 */
function linkStatFailure(link: ChainLink, error: unknown): AppException {
  if (MISSING_ERROR_CODES.has(errorCode(error) ?? ''))
    logger.warn(`路径在操作期间消失，已拒绝: ${link.abs}`)
  else
    logger.error(`路径校验失败: ${link.abs}`, error instanceof Error ? error.stack : String(error))

  return new AppException(ResponseCode.ProjectPathEscape)
}

/**
 * 全链校验：把每一级路径重新解析一遍，要求和握着的句柄指向同一个 inode，且中途没有软链。
 * 下钻过程中被掉包过，这里一定对不上。
 */
async function verifyChain(links: ChainLink[]): Promise<void> {
  for (const link of links) {
    let current: Stats
    try {
      current = link.followed ? await stat(link.abs) : await lstat(link.abs)
    }
    catch (error) {
      throw linkStatFailure(link, error)
    }

    assertLinkMatches(link, current)
  }
}

/** `verifyChain` 的同步版，给 `withLockedCwd` 里那段不能 await 的代码用 */
function verifyChainSync(links: ChainLink[]): void {
  for (const link of links) {
    let current: Stats
    try {
      current = link.followed ? statSync(link.abs) : lstatSync(link.abs)
    }
    catch (error) {
      throw linkStatFailure(link, error)
    }

    assertLinkMatches(link, current)
  }
}

/** 把打开的目标本身也纳入全链校验：句柄的 inode 必须等于路径当前 lstat 出来的 inode */
async function verifyTarget(links: ChainLink[], abs: string, handle: FileHandle): Promise<Stats> {
  const viaHandle = await handle.stat()

  let viaPath: Stats
  try {
    viaPath = await lstat(abs)
  }
  catch (error) {
    logger.error(`目标校验失败: ${abs}`, error instanceof Error ? error.stack : String(error))
    throw new AppException(ResponseCode.ProjectPathEscape)
  }

  if (viaPath.isSymbolicLink())
    throw new AppException(ResponseCode.ProjectFileIsSymlink)

  if (viaPath.dev !== viaHandle.dev || viaPath.ino !== viaHandle.ino) {
    logger.error(`目标在操作期间被掉包，已拒绝: ${abs}`)
    throw new AppException(ResponseCode.ProjectPathEscape)
  }

  await verifyChain(links)
  return viaHandle
}

/** 拆成「父目录各级」+「最后一段」，每一段都自己校验一遍 */
function splitParent(segments: string[]): { parent: string[], name: string } {
  const name = segments[segments.length - 1]
  if (!name)
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  assertSegments(segments)

  return { parent: segments.slice(0, -1), name }
}

function lastLink(links: ChainLink[]): ChainLink {
  return links[links.length - 1]!
}

export interface SafeFileHandleInfo {
  handle: FileHandle
  abs: string
  size: number
  updatedAt: Date
}

/**
 * 以只读方式安全地打开一个文件，返回句柄。
 * 调用方负责 `handle.close()`。
 *
 * 读不新建任何东西，所以不必进 `withLockedCwd`：竞态窗口里真打开了外面的文件，
 * `verifyTarget` 会发现句柄和路径的 inode 对不上，句柄当场关掉，一个字节都不会交出去。
 */
export async function safeOpenRead(root: string, segments: string[]): Promise<SafeFileHandleInfo> {
  const { parent, name } = splitParent(segments)
  const links = await openChain(root, parent)

  try {
    const abs = path.join(lastLink(links).abs, name)
    const handle = await open(abs, constants.O_RDONLY | O_NOFOLLOW).catch((error) => {
      throw mapOpenError(error, abs)
    })

    try {
      const stats = await verifyTarget(links, abs, handle)
      if (!stats.isFile())
        throw new AppException(ResponseCode.ProjectFilePathInvalid)

      return { handle, abs, size: stats.size, updatedAt: stats.mtime }
    }
    catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
  }
  finally {
    await closeChain(links)
  }
}

/** 读取整个文件，超过 `maxBytes` 直接拒绝（不读进内存） */
export async function safeReadFile(
  root: string,
  segments: string[],
  maxBytes: number,
): Promise<{ content: Buffer, size: number, updatedAt: Date }> {
  const { handle, size, updatedAt } = await safeOpenRead(root, segments)

  try {
    if (size > maxBytes)
      throw new AppException(ResponseCode.ProjectFileTooLarge)

    const content = await handle.readFile()
    return { content, size, updatedAt }
  }
  finally {
    await handle.close().catch(() => {})
  }
}

/** 只读一小段内容用来嗅探是不是文本 */
export async function safeSniff(root: string, segments: string[], bytes: number): Promise<Buffer> {
  const { handle, size } = await safeOpenRead(root, segments)

  try {
    const length = Math.min(bytes, size)
    if (length <= 0)
      return Buffer.alloc(0)

    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  }
  finally {
    await handle.close().catch(() => {})
  }
}

export interface SafeWriteOptions {
  /** true 时目标已存在直接报错（O_EXCL），用于上传这类不允许覆盖的场景 */
  exclusive?: boolean
}

/**
 * 在已经校验过的目录里打开（必要时新建）目标文件，返回裸 fd。
 * 全程同步、全程相对文件名，所以新建出来的文件一定落在这个目录里；
 * 校验没过时的撤销也在同一个窗口里做，删的必然是自己刚建的那个 entry。
 */
function openForWriteSync(
  links: ChainLink[],
  name: string,
  abs: string,
  options: SafeWriteOptions,
): { fd: number, stats: Stats } {
  let fd: number
  let created = true

  try {
    fd = openSync(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o644)
  }
  catch (error) {
    if (errorCode(error) !== 'EEXIST')
      throw mapOpenError(error, abs, ResponseCode.ProjectFileWriteFailed)

    if (options.exclusive)
      throw new AppException(ResponseCode.ProjectFileExists)

    // 已存在：不带 O_TRUNC 打开，等校验通过再截断，免得校验失败时已经毁了别人的文件
    created = false
    try {
      fd = openSync(name, constants.O_WRONLY | O_NOFOLLOW)
    }
    catch (openError) {
      throw mapOpenError(openError, abs, ResponseCode.ProjectFileWriteFailed)
    }
  }

  let opened: Stats | undefined

  try {
    opened = fstatSync(fd)
    verifyChainSync(links)

    if (!opened.isFile())
      throw new AppException(ResponseCode.ProjectFilePathInvalid)

    // 硬链接同样能把根目录外的文件拽进来，写之前一并挡掉
    if (opened.nlink > 1) {
      logger.error(`拒绝写入多重硬链接文件: ${abs}`)
      throw new AppException(ResponseCode.ProjectFileIsSymlink)
    }

    return { fd, stats: opened }
  }
  catch (error) {
    try {
      closeSync(fd)
    }
    catch {
      // 关不上也只能继续，下面的撤销更要紧
    }

    // fstat 都没成功就不知道该删哪个 inode，那就不删，免得误删别人的东西
    if (created && opened)
      discardCreatedSync(name, opened, abs)

    throw error
  }
}

/**
 * 撤掉刚刚新建出来的文件。这里一定还在校验过的目录里（`withLockedCwd` 的同步窗口内），
 * `name` 是纯文件名，所以删的必然是自己建的那个 entry，不会顺着软链删到别处。
 * inode 对不上说明这一瞬已经被人换成别的东西了，那就不是我们该删的。
 */
function discardCreatedSync(name: string, created: Stats, abs: string): void {
  try {
    const current = lstatSync(name)
    if (current.dev !== created.dev || current.ino !== created.ino)
      return

    unlinkSync(name)
  }
  catch (error) {
    if (MISSING_ERROR_CODES.has(errorCode(error) ?? ''))
      return

    logger.error(`撤销新建文件失败: ${abs}`, error instanceof Error ? error.stack : String(error))
  }
}

/**
 * 写文件。新建走 `O_EXCL`，覆盖走「打开已有句柄 + truncate」，全程 `O_NOFOLLOW`。
 * 打开动作在 `withLockedCwd` 里完成，落点由内核锁死在校验过的目录上；
 * 内容随后通过 fd 写下去，换软链也改不了落点。
 */
export async function safeWriteFile(
  root: string,
  segments: string[],
  data: Buffer,
  options: SafeWriteOptions = {},
): Promise<{ size: number, updatedAt: Date }> {
  const { parent, name } = splitParent(segments)
  const links = await openChain(root, parent)

  try {
    const parentLink = lastLink(links)
    const abs = path.join(parentLink.abs, name)
    const { fd } = withLockedCwd(parentLink, () => openForWriteSync(links, name, abs, options))

    try {
      await ftruncateAsync(fd, 0)
      if (data.length > 0)
        await writeAsync(fd, data, 0, data.length, 0)

      const written = await fstatAsync(fd)
      return { size: written.size, updatedAt: written.mtime }
    }
    finally {
      await closeAsync(fd).catch(() => {})
    }
  }
  finally {
    await closeChain(links)
  }
}

/**
 * 建一级目录。父目录必须已经存在。
 * 建的动作在 `withLockedCwd` 里做，所以新目录一定落在父目录里；
 * 建完再验一遍全链，校验不过就把刚建的删掉。
 */
export async function safeMkdir(
  root: string,
  segments: string[],
  options: { existOk?: boolean } = {},
): Promise<void> {
  const { parent, name } = splitParent(segments)
  const links = await openChain(root, parent)

  try {
    const parentLink = lastLink(links)
    const abs = path.join(parentLink.abs, name)

    withLockedCwd(parentLink, () => {
      try {
        mkdirSync(name)
      }
      catch (error) {
        if (errorCode(error) !== 'EEXIST')
          throw mapOpenError(error, abs, ResponseCode.ProjectFileWriteFailed)

        if (!options.existOk)
          throw new AppException(ResponseCode.ProjectFileExists)

        // 已存在的必须是真目录，不能是软链
        let existing: Stats
        try {
          existing = lstatSync(name)
        }
        catch (statError) {
          throw mapOpenError(statError, abs)
        }

        if (existing.isSymbolicLink())
          throw new AppException(ResponseCode.ProjectFileIsSymlink)
        if (!existing.isDirectory())
          throw new AppException(ResponseCode.ProjectFilePathInvalid)

        verifyChainSync(links)
        return
      }

      try {
        verifyChainSync(links)
      }
      catch (error) {
        // 校验没过说明这条链已经不可信了，把刚建的这一级撤掉
        try {
          rmdirSync(name)
        }
        catch (removeError) {
          logger.error(`撤销新建目录失败: ${abs}`, removeError instanceof Error ? removeError.stack : String(removeError))
        }

        throw error
      }
    })
  }
  finally {
    await closeChain(links)
  }
}

/** 逐级下钻建目录，每一级都单独校验，不用 `mkdir -p` */
export async function safeMkdirp(root: string, segments: string[]): Promise<void> {
  for (let i = 1; i <= segments.length; i++)
    await safeMkdir(root, segments.slice(0, i), { existOk: true })
}

/**
 * 列目录。读的是「校验过的那个目录」本身，每一项都 `lstat` 过，软链直接跳过（不展示也不让点）。
 *
 * 为什么不按路径 `readdir` 完再回头校验：软链换进来又换回去的那一瞬，回头校验是能通过的，
 * 列出来的却是根目录外面的文件名。锁住目录本身就没有这个缝。
 * 代价是这一段是同步的，目录特别大时会占着事件循环——物料目录不该大到这个程度。
 */
export async function safeReaddir(root: string, segments: string[], relBase: string): Promise<SafeEntryStat[]> {
  const links = await openChain(root, segments)

  try {
    const dirLink = lastLink(links)

    const entries = withLockedCwd(dirLink, () => {
      const names = readdirSync('.')
      const collected: SafeEntryStat[] = []

      for (const name of names) {
        let entry: Stats
        try {
          entry = lstatSync(name)
        }
        catch {
          // 列的过程中被删掉了，跳过
          continue
        }

        // 软链一律不展示：这层接口既不创建也不解析软链
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
          continue

        collected.push({
          name,
          relPath: relBase ? `${relBase}/${name}` : name,
          type: entry.isDirectory() ? 'dir' : 'file',
          size: entry.isDirectory() ? null : entry.size,
          updatedAt: entry.mtime,
        })
      }

      verifyChainSync(links)
      return collected
    })

    entries.sort((a, b) => {
      if (a.type !== b.type)
        return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return entries
  }
  finally {
    await closeChain(links)
  }
}

/** 取一个条目自身的信息，不跟随软链 */
export async function safeLstat(root: string, segments: string[]): Promise<Stats> {
  if (segments.length === 0) {
    const links = await openChain(root, [])
    try {
      return await links[0]!.handle.stat()
    }
    finally {
      await closeChain(links)
    }
  }

  const { parent, name } = splitParent(segments)
  const links = await openChain(root, parent)

  try {
    const parentLink = lastLink(links)
    const abs = path.join(parentLink.abs, name)

    return withLockedCwd(parentLink, () => {
      let entry: Stats
      try {
        entry = lstatSync(name)
      }
      catch (error) {
        throw mapOpenError(error, abs)
      }

      verifyChainSync(links)
      return entry
    })
  }
  finally {
    await closeChain(links)
  }
}

/**
 * 改名 / 移动。源和目标都不许是软链，目标已存在直接拒绝。
 *
 * 锁的是**目标**那一侧的目录：落点由内核锁死在校验过的目录里，所以东西绝对搬不出根目录。
 * 源那一侧用相对路径（同目录就是纯文件名，跨目录靠 `..` 回到真实父目录再往下走），
 * 仍然是按路径解析的——最坏情况是把外面的东西搬进来，不是搬出去。
 */
export async function safeRename(root: string, fromSegments: string[], toSegments: string[]): Promise<void> {
  const from = splitParent(fromSegments)
  const to = splitParent(toSegments)

  const fromLinks = await openChain(root, from.parent)
  try {
    const toLinks = await openChain(root, to.parent)
    try {
      const fromParentAbs = lastLink(fromLinks).abs
      const toLink = lastLink(toLinks)
      const fromAbs = path.join(fromParentAbs, from.name)
      const toAbs = path.join(toLink.abs, to.name)

      const relParent = path.relative(toLink.abs, fromParentAbs)
      const sourceRel = relParent.length > 0 ? path.join(relParent, from.name) : from.name

      withLockedCwd(toLink, () => {
        verifyChainSync(fromLinks)
        verifyChainSync(toLinks)

        let source: Stats
        try {
          source = lstatSync(sourceRel)
        }
        catch (error) {
          throw mapOpenError(error, fromAbs)
        }

        if (source.isSymbolicLink())
          throw new AppException(ResponseCode.ProjectFileIsSymlink)

        try {
          lstatSync(to.name)
          throw new AppException(ResponseCode.ProjectFileExists)
        }
        catch (error) {
          if (error instanceof AppException)
            throw error
          if (!MISSING_ERROR_CODES.has(errorCode(error) ?? ''))
            throw mapOpenError(error, toAbs, ResponseCode.ProjectFileWriteFailed)
        }

        try {
          renameSync(sourceRel, to.name)
        }
        catch (error) {
          logger.error(`改名失败: ${fromAbs} -> ${toAbs}`, error instanceof Error ? error.stack : String(error))
          throw mapOpenError(error, toAbs, ResponseCode.ProjectFileWriteFailed)
        }

        verifyChainSync(fromLinks)
        verifyChainSync(toLinks)
      })
    }
    finally {
      await closeChain(toLinks)
    }
  }
  finally {
    await closeChain(fromLinks)
  }
}

/**
 * 删除。软链只删链接本身，绝不跟进去；目录递归删。
 * 整个过程都在 `withLockedCwd` 的同步窗口里，用相对文件名操作，
 * 所以删的每一样东西都在校验过的目录树里面。
 */
export async function safeRemove(root: string, segments: string[]): Promise<void> {
  const { parent, name } = splitParent(segments)
  const links = await openChain(root, parent)

  try {
    const parentLink = lastLink(links)
    const abs = path.join(parentLink.abs, name)

    withLockedCwd(parentLink, () => {
      verifyChainSync(links)

      let entry: Stats
      try {
        entry = lstatSync(name)
      }
      catch (error) {
        throw mapOpenError(error, abs)
      }

      // 软链：只摘链接，不碰它指向的东西
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        unlinkSync(name)
        return
      }

      removeDirSync(name, entry, abs)
      verifyChainSync(links)
    })
  }
  finally {
    await closeChain(links)
  }
}

/**
 * 递归删目录：不拿路径字符串，而是 `chdir` 一层层走下去。
 *
 * 每进一层立刻 `statSync('.')` 和刚才 `lstat` 到的 inode 对一遍——
 * 并发把这一层换成指向外面的软链时，进去的就不是原来那个目录，inode 对不上，整单拒绝。
 * 目录里的每一项也各自 `lstat`：是软链就只 `unlink` 链接本身，绝不跟进去。
 */
function removeDirSync(name: string, expected: Stats, abs: string): void {
  const parentStat = statSync('.')

  process.chdir(name)
  let returned = false

  try {
    const here = statSync('.')
    if (here.dev !== expected.dev || here.ino !== expected.ino) {
      logger.error(`删除途中目录被掉包，已拒绝: ${abs}`)
      throw new AppException(ResponseCode.ProjectPathEscape)
    }

    for (const child of readdirSync('.')) {
      let entry: Stats
      try {
        entry = lstatSync(child)
      }
      catch {
        // 删的过程中自己没了，跳过
        continue
      }

      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        unlinkSync(child)
        continue
      }

      removeDirSync(child, entry, path.join(abs, child))
    }
  }
  finally {
    try {
      process.chdir('..')
      const back = statSync('.')
      returned = back.dev === parentStat.dev && back.ino === parentStat.ino
    }
    catch {
      returned = false
    }
  }

  if (!returned) {
    logger.error(`删除后回不到原来的父目录，已拒绝: ${abs}`)
    throw new AppException(ResponseCode.ProjectPathEscape)
  }

  rmdirSync(name)
}
