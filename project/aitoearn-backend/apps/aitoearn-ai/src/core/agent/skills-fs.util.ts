/**
 * 技能目录的磁盘操作：递归复制、列文件。
 *
 * 只认普通文件和目录，**软链一律跳过**：技能目录里不该有软链，有也不能顺着它
 * 把别处的文件复制进 Agent 读的目录、或者列给人看。
 *
 * 不依赖技能的其他模块，`SkillInitService` 和上传那边都用它，免得互相 import 成环。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 以 `.` 开头的是落盘过程中的临时目录（`.tmp-*` 解压中、`.trash-*` 待删），
 * 技能名本身不可能以 `.` 开头，所以列表和同步一律跳过它们。
 */
export function isHiddenEntryName(name: string): boolean {
  return name.startsWith('.')
}

/** 整目录递归复制，只复制普通文件和目录；文件权限（scripts 的 0755）随 copyFile 一起带过去 */
export function copyDirectoryRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)

    if (entry.isDirectory())
      copyDirectoryRecursive(from, to)
    else if (entry.isFile())
      fs.copyFileSync(from, to)
  }
}

function collectFiles(dir: string, prefix: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory())
      return collectFiles(path.join(dir, entry.name), relPath)

    return entry.isFile() ? [relPath] : []
  })
}

/**
 * 技能根目录下所有文件的相对路径：posix 分隔、按字符串排序、最多 `limit` 条。
 * 目录不存在或读不了返回空数组——列表少几行，总好过整个接口挂掉。
 */
export function listFilesRecursive(dir: string, limit: number): string[] {
  try {
    return collectFiles(dir, '').sort().slice(0, limit)
  }
  catch {
    return []
  }
}

/** lstat 判断是不是普通文件（软链不算） */
export function isRegularFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile()
  }
  catch {
    return false
  }
}

/** lstat 判断是不是真实目录（软链不算） */
export function isRealDirectory(dir: string): boolean {
  try {
    return fs.lstatSync(dir).isDirectory()
  }
  catch {
    return false
  }
}
