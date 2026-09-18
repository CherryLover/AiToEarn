/**
 * 发布标签页工具函数
 * 只做纯计算和浏览器动作：错误码翻人话、拼可复制的文本、判断链接、下载图片、状态样式。
 */

import type { PublishSnapshot } from '@/api/publishing/publishing.types'
import { POST_URL_MAX_LENGTH, PUBLISHING_ERROR_CODE } from '@/api/publishing/publishing.constants'
import { LinkStatus, PublishStatus } from '@/api/publishing/publishing.types'
import { getProjectErrorKey } from '../../../projects.utils'
import { PLATFORM_VALUES } from './publish.constants'

/**
 * 把服务端错误码翻成 projects 命名空间下的文案键。
 * 20500 段是发布自己的，其余（项目、物料文件、网络）交给项目页那套映射。
 */
export function getPublishErrorKey(code?: string | number | null): string {
  if (code === undefined || code === null)
    return 'error.network'

  switch (Number(code)) {
    case PUBLISHING_ERROR_CODE.NotFound:
      return 'publishError.notFound'
    case PUBLISHING_ERROR_CODE.ProjectMismatch:
      return 'publishError.projectMismatch'
    case PUBLISHING_ERROR_CODE.DraftPathInvalid:
      return 'publishError.draftPathInvalid'
    case PUBLISHING_ERROR_CODE.DraftNotFound:
      return 'publishError.draftNotFound'
    case PUBLISHING_ERROR_CODE.DraftInvalid:
      return 'publishError.draftInvalid'
    case PUBLISHING_ERROR_CODE.DraftEmpty:
      return 'publishError.draftEmpty'
    case PUBLISHING_ERROR_CODE.AutoModeNotSupported:
      return 'publishError.autoModeNotSupported'
    case PUBLISHING_ERROR_CODE.Duplicate:
      return 'publishError.duplicate'
    case PUBLISHING_ERROR_CODE.AlreadyCompleted:
      return 'publishError.alreadyCompleted'
    case PUBLISHING_ERROR_CODE.UrlInvalid:
      return 'publishError.urlInvalid'
    case PUBLISHING_ERROR_CODE.CreateFailed:
      return 'publishError.createFailed'
    case PUBLISHING_ERROR_CODE.StatusInvalid:
      return 'publishError.statusInvalid'
    default:
      return getProjectErrorKey(code)
  }
}

/**
 * 话题拼成一行，统一补上 #。
 */
export function formatTopics(topics: string[]): string {
  return topics
    .map(topic => topic.trim())
    .filter(Boolean)
    .map(topic => (topic.startsWith('#') ? topic : `#${topic}`))
    .join(' ')
}

/**
 * 「全部复制」的内容：标题、正文、话题按顺序拼起来，空的那段跳过。
 */
export function buildFullCopyText(snapshot: PublishSnapshot): string {
  const topics = formatTopics(snapshot.topics ?? [])

  return [snapshot.title, snapshot.body, topics]
    .map(part => (part ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 帖子链接得是 http/https，长度也有限。
 * 返回文案键，合法时返回 null。
 */
export function validatePostUrl(raw: string): string | null {
  const url = raw.trim()

  if (!url)
    return 'publish.card.urlRequired'

  if (url.length > POST_URL_MAX_LENGTH)
    return 'publish.card.urlTooLong'

  if (!/^https?:\/\/\S+$/i.test(url))
    return 'publish.card.urlInvalid'

  return null
}

/**
 * 草稿目录名形如 `<yyyy-MM-dd>-<平台>-<方向slug>`，从里面认平台，认不出来返回空串。
 */
export function guessPlatformFromDraftPath(draftPath: string): string {
  const name = draftPath.split('/').pop() ?? ''
  return PLATFORM_VALUES.find(platform => name.includes(`-${platform}-`)) ?? ''
}

/**
 * 从 OSS 地址里取一个像样的文件名，取不到就用序号补一个。
 */
export function buildImageFileName(url: string, index: number): string {
  const fallback = `image-${index + 1}.jpg`

  try {
    const path = new URL(url, 'https://placeholder.local').pathname
    const name = decodeURIComponent(path.split('/').pop() ?? '')
    return /\.[a-z0-9]{2,5}$/i.test(name) ? name : fallback
  }
  catch {
    return fallback
  }
}

/** 触发一次浏览器下载 */
function triggerDownload(href: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 下载一张图。
 * 先按 blob 存，这样能控制文件名；跨域拿不到（OSS 没开 CORS）就退回新标签页打开，让人自己右键存。
 * 返回 true 表示确实下下来了，false 表示只是开了个新标签页。
 */
export async function downloadImage(url: string, fileName: string): Promise<boolean> {
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl, fileName)
    // 立刻回收会让部分浏览器来不及开始下载，留一小会儿
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
    return true
  }
  catch (error) {
    console.error('Download publish image failed:', error)
    window.open(url, '_blank', 'noopener,noreferrer')
    return false
  }
}

/**
 * 复制到剪贴板。
 * 优先用 Clipboard API；非 HTTPS 环境（局域网自测）没有这个 API，退回老的 execCommand。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text)
    return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  }
  catch (error) {
    console.error('Clipboard write failed, fallback to execCommand:', error)
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  }
  catch (error) {
    console.error('Copy to clipboard failed:', error)
    return false
  }
}

/**
 * 发布状态的徽标样式，沿用主题色，不引入新配色。
 */
export function getPublishStatusClassName(status: PublishStatus): string {
  switch (status) {
    case PublishStatus.Published:
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case PublishStatus.Failed:
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    case PublishStatus.Publishing:
      return 'border-brand-cyan/40 bg-brand-cyan/10 text-foreground'
    case PublishStatus.Pending:
    default:
      return 'border-border bg-muted/60 text-foreground'
  }
}

/**
 * 链接状态的徽标样式。和发布状态分开显示，别合成一个。
 */
export function getLinkStatusClassName(status: LinkStatus): string {
  switch (status) {
    case LinkStatus.Claimed:
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case LinkStatus.ClaimFailed:
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    case LinkStatus.None:
    default:
      return 'border-border bg-muted/60 text-muted-foreground'
  }
}

/**
 * 已知平台返回文案键（跟草稿那边共用一张表），没收录的返回 null，由调用方显示原始值。
 */
export function getPlatformLabelKey(platform: string): string | null {
  return PLATFORM_VALUES.includes(platform as (typeof PLATFORM_VALUES)[number])
    ? `drafts.platform.${platform}`
    : null
}
