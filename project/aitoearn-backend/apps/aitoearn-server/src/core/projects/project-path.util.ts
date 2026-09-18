import * as path from 'node:path'
import { AppException, ResponseCode } from '@yikart/common'

/** 单段长度上限（字节） */
export const MAX_PATH_SEGMENT_BYTES = 255
/** 整条相对路径长度上限（字节） */
export const MAX_PATH_BYTES = 1024
/** 目录树最大深度 */
export const MAX_TREE_DEPTH = 10
/** 文本读写的单文件上限 */
export const MAX_TEXT_FILE_BYTES = 1024 * 1024
/** 上传的单文件上限 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
/** 嗅探内容时读多少字节 */
export const SNIFF_BYTES = 8192

/**
 * 认得出的文本扩展名。没有扩展名的（`.gitkeep`、`LICENSE` 这类）走内容嗅探，
 * 在白名单里的也照样嗅探一遍，防止有人把二进制塞进 `.md`。
 */
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.properties',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.php',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.graphql',
  '.gql',
  '.srt',
  '.vtt',
  '.env',
  '.gitignore',
  '.editorconfig',
])

/**
 * 一律不让碰的路径段。
 *
 * AI 服务那边 Agent 的 `settingSources` 含 `'project'`（契约要求，CLAUDE.md 靠它自动加载），
 * SDK 会连着读工作目录下的 `.claude/settings.json`——里面的 hooks 就是 shell 命令，
 * `.claude/skills` 里的技能也会被加载。文件接口要是能往里写，就等于「先不开 Bash」这个决定
 * 不用改代码就能被数据绕开，所以这里和 AI 服务的 `canUseTool` 两侧都拉黑。
 *
 * `CLAUDE.md` **不在**黑名单里——它就是项目说明，本来就该让项目所有者改。
 */
const BLOCKED_SEGMENTS = new Set(['.claude', '.mcp.json'])

/**
 * 把用户传来的相对路径拆成段并校验。
 *
 * 规则（contract-stage1.md 「路径规则」）：只收相对项目根的路径，
 * 不收绝对路径、不收 `..`、不收空段 / NUL / 控制字符，单段 ≤ 255 字节、总长 ≤ 1024 字节。
 * 空字符串表示项目根本身，返回空数组。
 */
export function parseRelPath(input?: string | null): string[] {
  const raw = (input ?? '').trim()

  if (raw.length === 0)
    return []

  if (Buffer.byteLength(raw, 'utf8') > MAX_PATH_BYTES)
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  // NUL 和其它控制字符：不用正则，免得源码里塞进真正的控制字符
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7F)
      throw new AppException(ResponseCode.ProjectFilePathInvalid)
  }

  // 反斜杠不当分隔符也不当普通字符，一律拒绝，免得跨平台语义不一致
  if (raw.includes('\\'))
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  // 绝对路径注入
  if (raw.startsWith('/') || path.isAbsolute(raw))
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  // 末尾的 `/` 是写路径时的习惯，容忍掉；中间的空段照样拒绝
  const trimmed = raw.replace(/\/+$/, '')
  if (trimmed.length === 0)
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  const segments = trimmed.split('/')
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..')
      throw new AppException(ResponseCode.ProjectFilePathInvalid)

    if (Buffer.byteLength(segment, 'utf8') > MAX_PATH_SEGMENT_BYTES)
      throw new AppException(ResponseCode.ProjectFilePathInvalid)

    if (BLOCKED_SEGMENTS.has(segment.toLowerCase()))
      throw new AppException(ResponseCode.ProjectFilePathInvalid)
  }

  return segments
}

/** 和 `parseRelPath` 相同的校验，但要求至少一段（根目录本身不是合法目标） */
export function parseRelPathRequired(input?: string | null): string[] {
  const segments = parseRelPath(input)
  if (segments.length === 0)
    throw new AppException(ResponseCode.ProjectFilePathInvalid)

  return segments
}

/** 段数组拼回对外展示的相对路径 */
export function joinRelPath(segments: string[]): string {
  return segments.join('/')
}

/** 扩展名看起来是文本吗；没有扩展名时返回 null，交给内容嗅探定夺 */
export function isTextExtension(name: string): boolean | null {
  const ext = path.extname(name).toLowerCase()
  if (ext.length === 0)
    return null

  return TEXT_EXTENSIONS.has(ext)
}

/**
 * 内容嗅探：出现 NUL 字节，或者不可打印字符占比过高，就当二进制。
 * UTF-8 的中文物料不会被误判（多字节序列都在 0x80 以上，不计入控制字符）。
 */
export function looksBinary(sample: Buffer): boolean {
  if (sample.length === 0)
    return false

  let suspicious = 0
  for (const byte of sample) {
    if (byte === 0)
      return true

    // 制表、换行、回车、换页、退格以外的控制字符
    if (byte < 0x09 || (byte > 0x0D && byte < 0x20))
      suspicious++
  }

  return suspicious / sample.length > 0.1
}

/** 是不是图片：按上传带上来的 MIME 判断 */
export function isImageMimeType(mimeType?: string | null): boolean {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/')
}

/** 图片名片文件名：原件名后面直接加 `.md`（screenshot.png -> screenshot.png.md） */
export function buildImageCardName(fileName: string): string {
  return `${fileName}.md`
}
