/**
 * 就绪检查的 detail 清洗。
 *
 * 就绪检查会把上游的返回体、异常信息原样端到网页上给人看，所以这一层是硬要求：
 * **Key 绝不能出现在 detail 里，也不能出现在日志里**（contract-runtime-config 第四节）。
 *
 * ⚠️ 这一份在 `apps/aitoearn-ai/src/core/internal/readiness.sanitize.ts` 有一份等价副本。
 * 两个应用之间没有共享这类工具的 lib（参照 `notify.http.ts` / `notify.ssrf.ts` 的同款处理），
 * **改这里必须同步改那边**，两边的单测也是对着同一组用例写的。
 *
 * 清洗分三步，顺序不能换：
 * 1. 已知明文（配置里的 Key）整串替换掉——这是最可靠的一步；
 * 2. 再按形状抹掉「看着像密钥」的片段，防的是上游把别的 Key 回显在错误信息里；
 * 3. 压掉换行、截断。
 */

/** detail 最长这么多字符，超了截断。够看清一条上游报错，又不至于把整个响应体端上来 */
export const READINESS_DETAIL_MAX_LENGTH = 300

const REDACTED = '***'

/** 已知明文最短多长才值得替换：太短的（比如空串、`a`）整串替换会把正常文字打成马赛克 */
const MIN_SECRET_LENGTH = 6

/** 按形状抹密钥。每一条都要能解释「为什么它像密钥」，不然容易误伤正常文案 */
const SECRET_SHAPE_PATTERNS: [RegExp, string][] = [
  // URL 里的 user:password@
  [/\/\/[^/\s:@]+:[^/\s@]+@/g, `//${REDACTED}:${REDACTED}@`],
  // `"apiKey": "xxx"` / `api_key=xxx` / `token: xxx` 这类键值对，只抹值
  [
    /(["']?(?:api[-_]?key|secret[-_]?key|access[-_]?key|authorization|auth[-_]?token|token|secret|password)["']?\s*[:=]\s*["']?)([^"'\s,;}&]+)/gi,
    `$1${REDACTED}`,
  ],
  // Bearer / Basic 凭证
  [/\b(?:bearer|basic)\s+[\w.\-+/=]{6,}/gi, `Bearer ${REDACTED}`],
  // `sk-` 开头的常见 Key 形状（占位值 `sk-placeholder` 也在内）
  [/\bsk-[\w-]{3,}/gi, REDACTED],
  // 兜底：一长串没有分隔的不透明字符，正常中文/英文报错里不会出现
  [/\b[\w-]{32,}\b/g, REDACTED],
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toText(input: unknown): string {
  if (input == null)
    return ''
  if (typeof input === 'string')
    return input
  if (input instanceof Error)
    return input.message
  try {
    return JSON.stringify(input) ?? String(input)
  }
  catch {
    return String(input)
  }
}

/**
 * 把任意东西洗成一条能给人看的 detail。
 *
 * @param input 原始内容：字符串、异常、上游返回体都行
 * @param secrets 配置里的明文 Key，整串替换用。传进来的空串和过短的值会被忽略
 */
export function sanitizeDetail(input: unknown, secrets: readonly string[] = []): string {
  let text = toText(input)
  if (!text)
    return ''

  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH)
      continue
    text = text.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED)
  }

  for (const [pattern, replacement] of SECRET_SHAPE_PATTERNS) {
    text = text.replace(pattern, replacement)
  }

  text = text.replace(/\s+/g, ' ').trim()

  return text.length > READINESS_DETAIL_MAX_LENGTH
    ? `${text.slice(0, READINESS_DETAIL_MAX_LENGTH)}…`
    : text
}
