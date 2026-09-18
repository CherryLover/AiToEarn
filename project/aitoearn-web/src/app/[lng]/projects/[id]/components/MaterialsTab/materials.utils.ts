/**
 * 物料标签页工具函数
 * 只做纯计算：路径拼接、节点查找与替换、类型判断、名片解析。
 * 所有路径都是相对项目根的相对路径，根目录用空串表示。
 */

import type { FileNode } from '@/api/projects/project-file.types'
import {
  PROJECT_FILE_IMAGE_EXTENSIONS,
  PROJECT_FILE_PLACEHOLDER_NAMES,
  PROJECT_FILE_SEGMENT_MAX_LENGTH,
  PROJECT_FILE_TEXT_EXTENSIONS,
  PROJECT_MATERIAL_DIR_GUIDE_KEYS,
} from '@/api/projects/project-file.constants'
import { ProjectFileType } from '@/api/projects/project-file.types'

/** 目录名 / 文件名里不允许出现的字符：路径分隔符与控制字符 */
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARS = /[/\\\x00-\x1F\x7F]/

/**
 * 拼接相对路径，父目录为空串时表示项目根。
 */
export function joinMaterialPath(parent: string, name: string): string {
  if (!parent)
    return name
  return `${parent}/${name}`
}

/**
 * 取父目录路径，顶层返回空串。
 */
export function getParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/**
 * 取扩展名，含点，小写；没有扩展名返回空串。
 */
export function getFileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  if (index <= 0)
    return ''
  return name.slice(index).toLowerCase()
}

/**
 * 去掉扩展名的路径。
 */
export function stripExtension(path: string): string {
  const ext = getFileExtension(path)
  return ext ? path.slice(0, -ext.length) : path
}

/** 是否是图片 */
export function isImageFileName(name: string): boolean {
  return (PROJECT_FILE_IMAGE_EXTENSIONS as readonly string[]).includes(getFileExtension(name))
}

/** 是否按文本处理 */
export function isTextFileName(name: string): boolean {
  return (PROJECT_FILE_TEXT_EXTENSIONS as readonly string[]).includes(getFileExtension(name))
}

/** 是否是占位文件，统计份数时跳过 */
export function isPlaceholderFileName(name: string): boolean {
  return (PROJECT_FILE_PLACEHOLDER_NAMES as readonly string[]).includes(name)
}

/**
 * 目录路径对应的引导文案键，未知目录用 generic。
 */
export function getDirGuideKey(path: string): string {
  return PROJECT_MATERIAL_DIR_GUIDE_KEYS[path] ?? 'generic'
}

/**
 * 目录在前、文件在后，同类按名字排序。
 */
export function sortFileNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type)
      return a.type === ProjectFileType.Dir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * 服务端目录树可能返回根节点本身，也可能直接返回子节点数组，两种都接住。
 */
export function normalizeTreeResponse(
  data: FileNode | FileNode[] | null | undefined,
  rootPath: string,
): FileNode | null {
  if (!data)
    return null

  if (Array.isArray(data)) {
    return {
      name: rootPath ? rootPath.slice(rootPath.lastIndexOf('/') + 1) : '',
      path: rootPath,
      type: ProjectFileType.Dir,
      size: null,
      updatedAt: new Date().toISOString(),
      children: data,
    }
  }

  return data
}

/**
 * 按路径找节点，找不到返回 null。
 */
export function findNodeByPath(root: FileNode | null, path: string): FileNode | null {
  if (!root)
    return null
  if (root.path === path)
    return root
  if (!root.children)
    return null

  for (const child of root.children) {
    // 只往可能包含目标的分支下钻
    if (path === child.path || path.startsWith(`${child.path}/`)) {
      const found = findNodeByPath(child, path)
      if (found)
        return found
    }
  }

  return null
}

/**
 * 按路径替换节点，返回新的树，不改原对象。
 */
export function replaceNodeByPath(
  root: FileNode,
  path: string,
  replacer: (node: FileNode) => FileNode,
): FileNode {
  if (root.path === path)
    return replacer(root)

  if (!root.children)
    return root

  return {
    ...root,
    children: root.children.map((child) => {
      if (path === child.path || path.startsWith(`${child.path}/`))
        return replaceNodeByPath(child, path, replacer)
      return child
    }),
  }
}

/**
 * 统计一个节点下的物料份数，跳过占位文件。
 */
export function countMaterialFiles(node: FileNode | null): number {
  if (!node)
    return 0

  if (node.type === ProjectFileType.File)
    return isPlaceholderFileName(node.name) ? 0 : 1

  if (!node.children)
    return 0

  return node.children.reduce((sum, child) => sum + countMaterialFiles(child), 0)
}

/**
 * 目录下可见的子节点：排掉占位文件。
 */
export function getVisibleChildren(node: FileNode | null): FileNode[] {
  if (!node?.children)
    return []
  return sortFileNodes(node.children.filter(child => !isPlaceholderFileName(child.name)))
}

/**
 * 解析名片文件的 YAML front matter。
 * 只认最简单的 `key: value` 一层结构，够用即可，不引新依赖。
 */
export function parseFrontMatter(content: string): Record<string, string> {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n'))
    return {}

  const end = normalized.indexOf('\n---', 3)
  if (end < 0)
    return {}

  const block = normalized.slice(4, end)
  const result: Record<string, string> = {}

  block.split('\n').forEach((line) => {
    const index = line.indexOf(':')
    if (index <= 0)
      return
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key)
      result[key] = value
  })

  return result
}

/**
 * 图片对应的名片文件路径候选。
 * 契约写的是「同名加 .md」，两种理解都试一遍：`a.png.md` 和 `a.md`。
 */
export function getImageCardPathCandidates(imagePath: string): string[] {
  const withSuffix = `${imagePath}.md`
  const replaced = `${stripExtension(imagePath)}.md`
  return withSuffix === replaced ? [withSuffix] : [withSuffix, replaced]
}

/**
 * 校验新建 / 改名时输入的名字，返回 projects 命名空间下的文案键；合法返回 null。
 */
export function validateMaterialName(raw: string): string | null {
  const name = raw.trim()

  if (!name)
    return 'materials.nameError.required'

  if (name === '.' || name === '..')
    return 'materials.nameError.dots'

  if (INVALID_NAME_CHARS.test(name))
    return 'materials.nameError.charset'

  if (name.length > PROJECT_FILE_SEGMENT_MAX_LENGTH)
    return 'materials.nameError.tooLong'

  return null
}
