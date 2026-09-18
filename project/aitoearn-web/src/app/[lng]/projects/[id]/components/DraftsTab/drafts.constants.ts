/**
 * 草稿标签页常量
 * 草稿是文件不是表：目录结构、文件名、可选平台都定在这里，和 contract-stage2 对齐。
 */

/** 草稿根目录，相对项目根 */
export const DRAFTS_DIR = 'drafts'

/** 图片原件目录，相对项目根 */
export const MEDIA_DIR = 'media'

/** 草稿正文文件名 */
export const DRAFT_CONTENT_FILE = 'content.md'

/** 草稿血缘文件名 */
export const DRAFT_META_FILE = 'meta.json'

/** 拉草稿列表时的目录层数：drafts/<草稿目录>/<文件> 三层够了 */
export const DRAFT_TREE_DEPTH = 3

/**
 * 可生成的平台。
 * value 就是草稿目录名里的平台段（`<yyyy-MM-dd>-<平台>-<方向slug>`），
 * 也是骨架契约里发布任务载荷的 platform 取值。
 */
export const DRAFT_PLATFORMS = [
  { value: 'xhs', recommended: true },
  { value: 'douyin', recommended: false },
  { value: 'wxSph', recommended: false },
  { value: 'wxGzh', recommended: false },
] as const

export type DraftPlatform = (typeof DRAFT_PLATFORMS)[number]['value']

/** 默认平台：阶段 2 的目标就是先把小红书这条打通 */
export const DEFAULT_DRAFT_PLATFORM: DraftPlatform = 'xhs'

/** 正文 frontmatter 里可能放标题的字段，按优先级取第一个有值的 */
export const DRAFT_TITLE_KEYS = ['title', 'name'] as const

/** 正文 frontmatter 里可能放话题的字段 */
export const DRAFT_TOPIC_KEYS = ['topics', 'tags', 'hashtags'] as const

/** 正文 frontmatter / meta.json 里可能放配图的字段 */
export const DRAFT_MEDIA_KEYS = ['images', 'media', 'mediaPaths', 'mediaUrls', 'cover', 'coverImage'] as const
