/**
 * 项目物料文件接口常量
 * 与服务端契约保持一致：大小限制、路径限制、业务错误码、标准物料目录。
 */

/** 目录树默认展开层数 */
export const PROJECT_FILE_TREE_DEFAULT_DEPTH = 3

/** 目录树最大展开层数 */
export const PROJECT_FILE_TREE_MAX_DEPTH = 10

/** 文本读写单文件上限，超过要走下载 */
export const PROJECT_FILE_TEXT_MAX_SIZE = 1024 * 1024

/** 上传单文件上限 */
export const PROJECT_FILE_UPLOAD_MAX_SIZE = 100 * 1024 * 1024

/** 路径总长上限 */
export const PROJECT_FILE_PATH_MAX_LENGTH = 1024

/** 单段路径长度上限 */
export const PROJECT_FILE_SEGMENT_MAX_LENGTH = 255

/** 物料文件业务错误码，对应服务端 ResponseCode 20100 段 */
export const PROJECT_FILE_ERROR_CODE = {
  /** 文件或目录不存在 */
  NotFound: 20100,
  /** 路径不合法 */
  PathInvalid: 20101,
  /** 文件太大 */
  TooLarge: 20102,
  /** 不是文本文件 */
  NotText: 20103,
  /** 同名文件已存在 */
  Exists: 20104,
  /** 写入失败 */
  WriteFailed: 20105,
  /** 目标是软链，拒绝操作 */
  IsSymlink: 20106,
  /** 上传失败 */
  UploadFailed: 20107,
} as const

/**
 * 标准物料目录，顺序即展示顺序。
 * `guideKey` 对应 projects 文案里的 `materials.guide.<guideKey>`。
 */
export const PROJECT_MATERIAL_DIRS = [
  { path: 'background/product', guideKey: 'backgroundProduct' },
  { path: 'background/website', guideKey: 'backgroundWebsite' },
  { path: 'background/feedback', guideKey: 'backgroundFeedback' },
  { path: 'background/legal', guideKey: 'backgroundLegal' },
  { path: 'angles', guideKey: 'angles' },
  { path: 'drafts', guideKey: 'drafts' },
  { path: 'media', guideKey: 'media' },
] as const

/** 目录路径到文案键的映射，含非叶子目录与根目录 */
export const PROJECT_MATERIAL_DIR_GUIDE_KEYS: Record<string, string> = {
  '': 'root',
  'background': 'background',
  'background/product': 'backgroundProduct',
  'background/website': 'backgroundWebsite',
  'background/feedback': 'backgroundFeedback',
  'background/legal': 'backgroundLegal',
  'angles': 'angles',
  'drafts': 'drafts',
  'media': 'media',
}

/** 占位文件，统计物料份数时不计入 */
export const PROJECT_FILE_PLACEHOLDER_NAMES = ['.gitkeep'] as const

/** 图片扩展名，用于判断是否走图片预览 */
export const PROJECT_FILE_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
  '.ico',
] as const

/** 文本扩展名，用于判断是否走文本读写 */
export const PROJECT_FILE_TEXT_EXTENSIONS = [
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.sh',
  '.env',
  '.ini',
  '.toml',
  '.conf',
  '.sql',
  '.py',
] as const
