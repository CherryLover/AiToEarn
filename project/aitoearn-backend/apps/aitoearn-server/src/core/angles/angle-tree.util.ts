/**
 * 方向演进树的纯计算。
 *
 * 方向是假设不是分类，血统（`parentAngleId`）才是整套设计的核心：
 * 有了它才能一眼看出哪条线在往下长、哪条试两次就断了。
 * 这里只做内存里的组装和血统判定，不碰数据库、不碰文件，便于单测。
 *
 * 所有函数都假设数据里**可能**有脏血统（历史数据、并发改父）：
 * 指向不存在的父节点当作根，成环的节点提到根上，绝不进死循环。
 */

export interface AngleLineage {
  id: string
  parentAngleId?: string | null
}

export interface AngleTreeNode<T extends AngleLineage> {
  angle: T
  children: AngleTreeNode<T>[]
}

/** 把 id 映射成节点，顺带过滤掉没有 id 的脏数据 */
function indexById<T extends AngleLineage>(angles: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const angle of angles) {
    if (angle.id)
      map.set(angle.id, angle)
  }

  return map
}

/** 父 id：空串、null、undefined 一律当作「没有父方向」 */
function parentIdOf(angle: AngleLineage): string | null {
  return angle.parentAngleId ? angle.parentAngleId : null
}

/**
 * `candidateId` 是不是 `startId` 的祖先（含 startId 自己）。
 * 往上走的过程带 visited 兜底，数据里存在环也只会走一圈就停。
 */
export function isAngleAncestor(angles: AngleLineage[], candidateId: string, startId: string): boolean {
  const map = indexById(angles)
  const visited = new Set<string>()

  let current: string | null = startId
  while (current) {
    if (current === candidateId)
      return true

    if (visited.has(current))
      return false

    visited.add(current)
    const node: AngleLineage | undefined = map.get(current)
    current = node ? parentIdOf(node) : null
  }

  return false
}

/** 一个方向名下的全部后代 id（不含自己） */
export function collectDescendantIds(angles: AngleLineage[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const angle of angles) {
    const parentId = parentIdOf(angle)
    if (!parentId || parentId === angle.id)
      continue

    const list = childrenOf.get(parentId) ?? []
    list.push(angle.id)
    childrenOf.set(parentId, list)
  }

  const found = new Set<string>()
  const queue = [...(childrenOf.get(id) ?? [])]

  while (queue.length > 0) {
    const current = queue.shift()!
    // 环：走回已经收过的节点就停，不再往下
    if (current === id || found.has(current))
      continue

    found.add(current)
    queue.push(...(childrenOf.get(current) ?? []))
  }

  return found
}

/** 方向在血统里的层数，起点算第 1 层。节点不存在返回 0 */
export function angleDepth(angles: AngleLineage[], id: string): number {
  const map = indexById(angles)
  if (!map.has(id))
    return 0

  const visited = new Set<string>()
  let depth = 0
  let current: string | null = id

  while (current) {
    if (visited.has(current))
      break

    visited.add(current)
    depth++
    const node: AngleLineage | undefined = map.get(current)
    current = node ? parentIdOf(node) : null
    if (current && !map.has(current))
      break
  }

  return depth
}

/** 以这个方向为根的子树有多高，叶子算 1。节点不存在返回 0 */
export function angleHeight(angles: AngleLineage[], id: string): number {
  const map = indexById(angles)
  if (!map.has(id))
    return 0

  const childrenOf = new Map<string, string[]>()
  for (const angle of angles) {
    const parentId = parentIdOf(angle)
    if (!parentId || parentId === angle.id)
      continue

    const list = childrenOf.get(parentId) ?? []
    list.push(angle.id)
    childrenOf.set(parentId, list)
  }

  const walk = (current: string, seen: Set<string>): number => {
    if (seen.has(current))
      return 0

    seen.add(current)
    let best = 1
    for (const child of childrenOf.get(current) ?? [])
      best = Math.max(best, walk(child, seen) + 1)

    return best
  }

  return walk(id, new Set<string>())
}

/**
 * 组装方向演进树。
 * 入参顺序决定同级顺序（仓库里按 createdAt 正序取，先提出来的方向排前面）。
 * 父方向不存在、或者挂上去会成环的节点，一律提到根上，保证一棵不丢。
 */
export function buildAngleTree<T extends AngleLineage>(angles: T[]): AngleTreeNode<T>[] {
  const nodes = new Map<string, AngleTreeNode<T>>()
  for (const angle of angles) {
    if (angle.id)
      nodes.set(angle.id, { angle, children: [] })
  }

  const roots: AngleTreeNode<T>[] = []

  for (const angle of angles) {
    const node = nodes.get(angle.id)
    if (!node)
      continue

    const parentId = parentIdOf(angle)
    const parent = parentId ? nodes.get(parentId) : undefined

    // 没有父方向、父方向已经不在了、父方向是自己，都算一条线的起点
    if (!parent || parent.angle.id === angle.id) {
      roots.push(node)
      continue
    }

    // 挂上去会成环（父方向其实是自己的后代）：提到根上，免得整棵树消失在环里
    if (isAngleAncestor(angles, angle.id, parent.angle.id)) {
      roots.push(node)
      continue
    }

    parent.children.push(node)
  }

  return roots
}
