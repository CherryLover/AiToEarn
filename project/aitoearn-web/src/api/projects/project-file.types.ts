/**
 * 项目物料文件接口类型
 * 字段严格对应服务端 FileNodeVo / FileContentVo，
 * 不要在此处自行增删字段或改名。
 */

/**
 * 物料节点类型：目录或文件。
 */
export enum ProjectFileType {
  Dir = 'dir',
  File = 'file',
}

/**
 * FileNode 数据结构，对应服务端 FileNodeVo。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
export interface FileNode {
  name: string
  /** 相对项目根的路径 */
  path: string
  type: ProjectFileType
  /** 目录为 null */
  size: number | null
  updatedAt: string
  /** 未展开或非目录时为 null */
  children: FileNode[] | null
}

/**
 * FileContent 数据结构，对应服务端 FileContentVo。
 */
export interface FileContent {
  path: string
  content: string
  size: number
  updatedAt: string
}

/**
 * 目录树请求参数。
 */
export interface ProjectFileTreeParams {
  /** 相对项目根的路径，不传为根 */
  path?: string
  /** 展开层数，默认 3，最大 10 */
  depth?: number
}

/**
 * 写文本请求参数。
 */
export interface WriteProjectFileParams {
  path: string
  content: string
}

/**
 * 建文件夹请求参数。
 */
export interface MkdirProjectFileParams {
  path: string
}

/**
 * 改名 / 移动请求参数，两个都是相对项目根的路径。
 */
export interface RenameProjectFileParams {
  from: string
  to: string
}

/**
 * 删除请求参数。
 */
export interface DeleteProjectFileParams {
  path: string
}

/**
 * 删除返回，对应服务端 FileDeletedVo。
 */
export interface ProjectFileDeleted {
  /** 已删除的路径，相对项目根 */
  path: string
}

/**
 * 上传请求选项。
 * 上传走 XMLHttpRequest，fetch 拿不到上传进度。
 */
export interface UploadProjectFileOptions {
  /** 目标目录，相对项目根，根目录传空串 */
  path: string
  /** 0~100 */
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/**
 * 物料文件接口响应包装。
 * 上传不走统一的 http 封装，需要自己声明一份同形状的返回类型。
 */
export type ProjectFileApiResponse<T> = {
  code: string | number
  data: T
  message: string
} | null
