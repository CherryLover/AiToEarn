/**
 * 推送文案的拼装与截断。
 *
 * **推送是提醒，不是投递**：绝不把草稿正文、用户内容原样塞进去。
 * 标题最多 30 字、正文最多 100 字，超了截断并补省略号。
 *
 * 这份文件在 `apps/aitoearn-server/src/core/notify/notify.format.ts` 有一份完全相同的副本，改动时必须同步。
 */

/** 标题上限（字，按码点数，一个汉字算一个） */
export const NOTIFY_TITLE_MAX = 30

/** 正文上限（字，同上） */
export const NOTIFY_BODY_MAX = 100

export interface NotifyMessage {
  title: string
  body: string
}

/** 折成一行：换行、制表、连续空白一律压成单个空格，免得推送里出现半截排版 */
export function flattenText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * 按「字」截断。
 *
 * 用码点切而不是 `String.prototype.slice`：后者按 UTF-16 码元切，
 * 正好切在 emoji 或生僻字中间会留下半个代理对，推出去就是乱码。
 * 截断后长度**不超过** max（省略号自己也占一个字）。
 */
export function truncateText(text: string, max: number): string {
  if (max <= 0)
    return ''

  const chars = Array.from(flattenText(text))
  if (chars.length <= max)
    return chars.join('')

  if (max === 1)
    return '…'

  return `${chars.slice(0, max - 1).join('')}…`
}

/** 把若干段拼成 `a · b · c`，空的段直接丢掉 */
export function joinParts(parts: Array<string | undefined | null>): string {
  return parts
    .map(part => (part ?? '').trim())
    .filter(part => part.length > 0)
    .join(' · ')
}

export interface DraftReadyInput {
  /** 项目英文名（同时是目录名）。AI 服务这边拿不到数据库里的显示名 */
  projectName: string
  /** 草稿标题，来自 content.md 的 frontmatter */
  draftTitle?: string
  /** 方向 slug，来自 meta.json */
  angle?: string
  /** 平台代码，来自 meta.json；平台中立的草稿这里是空 */
  platform?: string
  /** 这一轮一共新出了几份草稿，大于 1 时在正文里点一下 */
  draftCount?: number
}

/** 「AI 生成草稿完成」的推送文案 */
export function draftReadyMessage(input: DraftReadyInput): NotifyMessage {
  const more = (input.draftCount ?? 1) > 1 ? `等 ${input.draftCount} 份` : ''

  return {
    title: '✅ 新草稿生成好了',
    body: joinParts([
      input.projectName,
      input.angle,
      input.platform,
      input.draftTitle,
      more,
    ]) || input.projectName,
  }
}

export interface ManualPublishInput {
  /** 平台代码 */
  platform?: string
  /** 内容快照里的标题 */
  title?: string
}

/** 「有一条等你去发」的推送文案（建 manual 工单时推） */
export function manualPublishMessage(input: ManualPublishInput): NotifyMessage {
  return {
    title: '📝 有一条等你去发',
    body: joinParts([
      input.platform,
      input.title,
      '发完回网页登记链接',
    ]),
  }
}
