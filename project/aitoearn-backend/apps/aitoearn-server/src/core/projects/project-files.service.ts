import type { Readable } from 'node:stream'
import * as path from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { AssetsService } from '@yikart/assets'
import { AppException, ResponseCode } from '@yikart/common'
import { AssetType } from '@yikart/mongodb'
import sizeOf from 'image-size'
import { lookup as lookupMimeType } from 'mime-types'
import { ProjectDirService } from './project-dir.service'
import {
  buildImageCardName,
  isImageMimeType,
  isTextExtension,
  joinRelPath,
  looksBinary,
  MAX_TEXT_FILE_BYTES,
  MAX_TREE_DEPTH,
  parseRelPath,
  parseRelPathRequired,
  SNIFF_BYTES,
} from './project-path.util'
import { ProjectsService } from './projects.service'
import {
  safeLstat,
  safeMkdir,
  safeOpenRead,
  safeReaddir,
  safeReadFile,
  safeRemove,
  safeRename,
  safeSniff,
  safeWriteFile,
} from './safe-fs'

export interface FileNode {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number | null
  updatedAt: Date
  children: FileNode[] | null
}

export interface FileContent {
  path: string
  content: string
  size: number
  updatedAt: Date
}

export interface UploadedFileInput {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

export interface DownloadPayload {
  stream: Readable
  size: number
  fileName: string
  contentType: string
}

/**
 * 修正 multipart 上传文件名的编码。
 *
 * multer 底下的 busboy 默认按 latin1 解 `Content-Disposition` 里的 `filename`，
 * 而浏览器发的是 UTF-8 字节，于是中文 / 日文 / emoji 到了 `originalname` 就成了乱码。
 * 这里把字符按 latin1 编回原始字节，再按 UTF-8 解一遍。
 *
 * 不无脑转：
 * - 有字符超出单字节范围 → 说明已经是解好的 Unicode（例如客户端走 RFC 5987 的
 *   `filename*=UTF-8''`，busboy 会正确解码），原样返回
 * - 解出来的结果编不回同一串字节 → 说明这串字节不是合法 UTF-8，原样返回
 *
 * 因此重复调用是安全的，本来就正确的名字不会被转坏。
 */
export function normalizeUploadFileName(originalName: string): string {
  if (!originalName)
    return originalName

  for (let i = 0; i < originalName.length; i++) {
    if (originalName.charCodeAt(i) > 0xFF)
      return originalName
  }

  const bytes = Buffer.from(originalName, 'latin1')
  const decoded = bytes.toString('utf8')

  return Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : originalName
}

/** 上传图片时一起写下的名片文件，正文固定留空——描述交给能读图的模型或人来补 */
const IMAGE_CARD_BODY = '（这张图是什么，上传时留空。以后由能读图的模型补上，或由你手写。）'

@Injectable()
export class ProjectFilesService {
  private readonly logger = new Logger(ProjectFilesService.name)

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectDirService: ProjectDirService,
    private readonly assetsService: AssetsService,
  ) {}

  /** 目录树。`relPath` 为空表示项目根，`depth` 控制展开几层 */
  async tree(projectId: string, userId: string, relPath?: string, depth = 3): Promise<FileNode> {
    const { root, dirName } = await this.locate(projectId, userId)
    const segments = parseRelPath(relPath)
    const levels = Math.min(Math.max(Math.trunc(depth), 1), MAX_TREE_DEPTH)

    const stats = await safeLstat(root, [dirName, ...segments])
    if (!stats.isDirectory())
      throw new AppException(ResponseCode.ProjectFilePathInvalid)

    return {
      name: segments.length > 0 ? segments[segments.length - 1]! : dirName,
      path: joinRelPath(segments),
      type: 'dir',
      size: null,
      updatedAt: stats.mtime,
      children: await this.listChildren(root, dirName, segments, levels),
    }
  }

  /** 读文本。二进制和超大文件一律拒绝，让前端走 download */
  async read(projectId: string, userId: string, relPath: string): Promise<FileContent> {
    const { root, dirName } = await this.locate(projectId, userId)
    const segments = parseRelPathRequired(relPath)
    const full = [dirName, ...segments]
    const name = segments[segments.length - 1]!

    const byExtension = isTextExtension(name)
    if (byExtension === false)
      throw new AppException(ResponseCode.ProjectFileNotText)

    // 扩展名看着像文本也照样嗅探一遍，防止有人把二进制塞进 .md
    const sample = await safeSniff(root, full, SNIFF_BYTES)
    if (looksBinary(sample))
      throw new AppException(ResponseCode.ProjectFileNotText)

    const { content, size, updatedAt } = await safeReadFile(root, full, MAX_TEXT_FILE_BYTES)

    return {
      path: joinRelPath(segments),
      content: content.toString('utf8'),
      size,
      updatedAt,
    }
  }

  /** 写文本。目标扩展名必须是文本类，内容上限和读一致 */
  async write(projectId: string, userId: string, relPath: string, content: string): Promise<FileContent> {
    const { root, dirName } = await this.locate(projectId, userId)
    const segments = parseRelPathRequired(relPath)
    const name = segments[segments.length - 1]!

    if (isTextExtension(name) === false)
      throw new AppException(ResponseCode.ProjectFileNotText)

    const buffer = Buffer.from(content, 'utf8')
    if (buffer.length > MAX_TEXT_FILE_BYTES)
      throw new AppException(ResponseCode.ProjectFileTooLarge)

    const written = await this.wrapWrite(
      () => safeWriteFile(root, [dirName, ...segments], buffer),
      `写文件失败: ${dirName}/${joinRelPath(segments)}`,
    )

    return {
      path: joinRelPath(segments),
      content,
      size: written.size,
      updatedAt: written.updatedAt,
    }
  }

  /** 建文件夹。父目录必须已存在，同名已存在直接报错 */
  async mkdir(projectId: string, userId: string, relPath: string): Promise<FileNode> {
    const { root, dirName } = await this.locate(projectId, userId)
    const segments = parseRelPathRequired(relPath)

    await safeMkdir(root, [dirName, ...segments])
    const stats = await safeLstat(root, [dirName, ...segments])

    return {
      name: segments[segments.length - 1]!,
      path: joinRelPath(segments),
      type: 'dir',
      size: null,
      updatedAt: stats.mtime,
      children: null,
    }
  }

  /** 改名 / 移动。目标已存在直接拒绝，不覆盖 */
  async rename(projectId: string, userId: string, from: string, to: string): Promise<FileNode> {
    const { root, dirName } = await this.locate(projectId, userId)
    const fromSegments = parseRelPathRequired(from)
    const toSegments = parseRelPathRequired(to)

    await safeRename(root, [dirName, ...fromSegments], [dirName, ...toSegments])
    const stats = await safeLstat(root, [dirName, ...toSegments])

    return {
      name: toSegments[toSegments.length - 1]!,
      path: joinRelPath(toSegments),
      type: stats.isDirectory() ? 'dir' : 'file',
      size: stats.isDirectory() ? null : stats.size,
      updatedAt: stats.mtime,
      children: null,
    }
  }

  /** 删除。软链只摘链接本身，目录递归删但不跟软链出去 */
  async remove(projectId: string, userId: string, relPath: string): Promise<{ path: string }> {
    const { root, dirName } = await this.locate(projectId, userId)
    const segments = parseRelPathRequired(relPath)

    await safeRemove(root, [dirName, ...segments])
    return { path: joinRelPath(segments) }
  }

  /**
   * 上传文件到指定目录。
   * 图片额外做两件事：传一份到 OSS，在原件旁边写一个名片文件。
   * OSS 失败不阻塞——原件已经落盘了，名片里 `oss` 留空并记日志。
   */
  async upload(
    projectId: string,
    userId: string,
    dirPath: string | undefined,
    file: UploadedFileInput,
  ): Promise<FileNode> {
    const { root, dirName } = await this.locate(projectId, userId)
    const dirSegments = parseRelPath(dirPath)

    // 文件名只取最后一段，顺带走一遍路径规则（拦住 `../`、控制字符、超长名）
    const fileName = parseRelPathRequired(path.basename(file.originalname || ''))[0]!
    const segments = [...dirSegments, fileName]

    const written = await this.wrapWrite(
      () => safeWriteFile(root, [dirName, ...segments], file.buffer, { exclusive: true }),
      `上传落盘失败: ${dirName}/${joinRelPath(segments)}`,
    )

    if (isImageMimeType(file.mimetype))
      await this.writeImageCard(root, userId, dirName, dirSegments, fileName, file, written.size)

    return {
      name: fileName,
      path: joinRelPath(segments),
      type: 'file',
      size: written.size,
      updatedAt: written.updatedAt,
      children: null,
    }
  }

  /** 下载原件，二进制也走这里 */
  async download(projectId: string, userId: string, relPath: string): Promise<DownloadPayload> {
    const { root, dirName } = await this.locate(projectId, userId)
    const segments = parseRelPathRequired(relPath)
    const fileName = segments[segments.length - 1]!

    const { handle, size } = await safeOpenRead(root, [dirName, ...segments])

    return {
      stream: handle.createReadStream({ autoClose: true }),
      size,
      fileName,
      contentType: lookupMimeType(fileName) || 'application/octet-stream',
    }
  }

  /** 拿到项目物料根和项目目录名，顺带校验归属和未归档 */
  private async locate(projectId: string, userId: string): Promise<{ root: string, dirName: string }> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    return { root: this.projectDirService.root, dirName: project.dirName }
  }

  private async listChildren(
    root: string,
    dirName: string,
    segments: string[],
    levels: number,
  ): Promise<FileNode[]> {
    const entries = await safeReaddir(root, [dirName, ...segments], joinRelPath(segments))
    const nodes: FileNode[] = []

    for (const entry of entries) {
      const childSegments = [...segments, entry.name]
      const expand = entry.type === 'dir' && levels > 1

      nodes.push({
        name: entry.name,
        path: entry.relPath,
        type: entry.type,
        size: entry.size,
        updatedAt: entry.updatedAt,
        children: expand ? await this.listChildren(root, dirName, childSegments, levels - 1) : null,
      })
    }

    return nodes
  }

  /**
   * 写图片名片：原件旁边一个同名加 `.md` 的文本文件，Agent `cat` 得到、`tree` 里看得见。
   * 正文固定留空，不让代码编造图片描述。
   */
  private async writeImageCard(
    root: string,
    userId: string,
    dirName: string,
    dirSegments: string[],
    fileName: string,
    file: UploadedFileInput,
    size: number,
  ): Promise<void> {
    const ossUrl = await this.uploadToOss(userId, file)
    const dimensions = this.readImageSize(file.buffer, fileName)

    const front: string[] = [
      '---',
      `file: ${fileName}`,
      'type: image',
      `oss: ${ossUrl}`,
      `size: ${size}`,
    ]
    if (dimensions) {
      front.push(`width: ${dimensions.width}`)
      front.push(`height: ${dimensions.height}`)
    }
    front.push(`uploadedAt: ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`)
    front.push('---')

    const card = `${front.join('\n')}\n\n${IMAGE_CARD_BODY}\n`
    const cardSegments = [...dirSegments, buildImageCardName(fileName)]

    try {
      await safeWriteFile(root, [dirName, ...cardSegments], Buffer.from(card, 'utf8'))
    }
    catch (error) {
      // 名片写失败不能把已经落盘的原件退回去，记日志就好
      this.logger.error(
        `图片名片写入失败: ${dirName}/${joinRelPath(cardSegments)}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  /** 传一份到 OSS，复用 assets 的上传能力。失败返回空串，由调用方把名片里的 oss 留空 */
  private async uploadToOss(userId: string, file: UploadedFileInput): Promise<string> {
    try {
      const result = await this.assetsService.uploadFromBuffer(userId, file.buffer, {
        type: AssetType.UserMedia,
        mimeType: file.mimetype,
        filename: file.originalname,
      })

      return result.url
    }
    catch (error) {
      this.logger.error(
        `图片传 OSS 失败，名片里 oss 留空: ${file.originalname}`,
        error instanceof Error ? error.stack : String(error),
      )
      return ''
    }
  }

  private readImageSize(buffer: Buffer, fileName: string): { width: number, height: number } | null {
    try {
      const { width, height } = sizeOf(buffer)
      if (typeof width === 'number' && typeof height === 'number')
        return { width, height }

      return null
    }
    catch (error) {
      this.logger.warn(`读不出图片尺寸，名片里不写宽高: ${fileName} ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** 写入类操作统一兜底：业务异常原样抛，其它一律翻成「写入失败」 */
  private async wrapWrite<T>(run: () => Promise<T>, message: string): Promise<T> {
    try {
      return await run()
    }
    catch (error) {
      if (error instanceof AppException)
        throw error

      this.logger.error(message, error instanceof Error ? error.stack : String(error))
      throw new AppException(ResponseCode.ProjectFileWriteFailed)
    }
  }
}
