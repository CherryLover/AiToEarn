import { describe, expect, it } from 'vitest'
import {
  angleDepth,
  angleHeight,
  buildAngleTree,
  collectDescendantIds,
  isAngleAncestor,
} from './angle-tree.util'

/** 一条线：root → mid → leaf，另加一条独立的 solo */
const angles = [
  { id: 'root', parentAngleId: null },
  { id: 'mid', parentAngleId: 'root' },
  { id: 'leaf', parentAngleId: 'mid' },
  { id: 'solo', parentAngleId: null },
]

describe('方向演进树 · 组装', () => {
  it('按血统串成树，同级保持入参顺序', () => {
    const tree = buildAngleTree(angles)

    expect(tree.map(node => node.angle.id)).toEqual(['root', 'solo'])
    expect(tree[0]!.children.map(node => node.angle.id)).toEqual(['mid'])
    expect(tree[0]!.children[0]!.children.map(node => node.angle.id)).toEqual(['leaf'])
    expect(tree[1]!.children).toEqual([])
  })

  it('同一个父方向下的多个子方向都挂上去', () => {
    const tree = buildAngleTree([
      { id: 'root', parentAngleId: null },
      { id: 'a', parentAngleId: 'root' },
      { id: 'b', parentAngleId: 'root' },
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]!.children.map(node => node.angle.id)).toEqual(['a', 'b'])
  })

  it('父方向已经不在了：提到根上，不能整棵丢掉', () => {
    const tree = buildAngleTree([
      { id: 'orphan', parentAngleId: 'gone' },
      { id: 'root', parentAngleId: null },
    ])

    expect(tree.map(node => node.angle.id)).toEqual(['orphan', 'root'])
  })

  it('数据里存在环：不死循环，把环上的节点提到根上', () => {
    const tree = buildAngleTree([
      { id: 'a', parentAngleId: 'b' },
      { id: 'b', parentAngleId: 'a' },
    ])

    const ids = tree.map(node => node.angle.id)
    expect(ids).toContain('a')
    // 两个节点一个都不能丢：要么各自成根，要么一个挂在另一个下面
    const all = new Set<string>()
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        all.add(node.angle.id)
        walk(node.children)
      }
    }
    walk(tree)
    expect([...all].sort()).toEqual(['a', 'b'])
  })

  it('自己是自己的父方向：当成一条线的起点', () => {
    const tree = buildAngleTree([{ id: 'a', parentAngleId: 'a' }])
    expect(tree.map(node => node.angle.id)).toEqual(['a'])
  })
})

describe('方向演进树 · 血统判定', () => {
  it('后代集合不含自己', () => {
    expect([...collectDescendantIds(angles, 'root')].sort()).toEqual(['leaf', 'mid'])
    expect([...collectDescendantIds(angles, 'leaf')]).toEqual([])
  })

  it('祖先判定：往上走得到就算，自己也算', () => {
    expect(isAngleAncestor(angles, 'root', 'leaf')).toBe(true)
    expect(isAngleAncestor(angles, 'leaf', 'root')).toBe(false)
    expect(isAngleAncestor(angles, 'leaf', 'leaf')).toBe(true)
  })

  it('环上的祖先判定不死循环', () => {
    const cyclic = [
      { id: 'a', parentAngleId: 'b' },
      { id: 'b', parentAngleId: 'a' },
    ]

    expect(isAngleAncestor(cyclic, 'c', 'a')).toBe(false)
    expect([...collectDescendantIds(cyclic, 'a')].sort()).toEqual(['b'])
  })

  it('层数：起点算第 1 层', () => {
    expect(angleDepth(angles, 'root')).toBe(1)
    expect(angleDepth(angles, 'mid')).toBe(2)
    expect(angleDepth(angles, 'leaf')).toBe(3)
    expect(angleDepth(angles, 'gone')).toBe(0)
  })

  it('子树高度：叶子算 1', () => {
    expect(angleHeight(angles, 'root')).toBe(3)
    expect(angleHeight(angles, 'mid')).toBe(2)
    expect(angleHeight(angles, 'leaf')).toBe(1)
    expect(angleHeight(angles, 'gone')).toBe(0)
  })
})
