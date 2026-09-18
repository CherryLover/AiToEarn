/**
 * useMaterials - 物料目录树的状态与操作
 * 只管目录树、展开状态、选中项和目录级的增删改；文件内容读写在 FileContentPanel 里。
 */
'use client'

import type { FileNode } from '@/api/projects/project-file.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteProjectFileApi,
  getProjectFileTreeApi,
  mkdirProjectFileApi,
  renameProjectFileApi,
} from '@/api/projects/project-file.api'
import { PROJECT_FILE_TREE_MAX_DEPTH } from '@/api/projects/project-file.constants'
import { ProjectFileType } from '@/api/projects/project-file.types'
import { findNodeByPath, normalizeTreeResponse, replaceNodeByPath } from './materials.utils'

/** 默认展开的目录，进来就能看到物料该往哪放 */
const DEFAULT_EXPANDED = ['', 'background']

export interface MaterialMutationResult {
  ok: boolean
  /** 失败时服务端返回的业务码，请求本身没通时为 undefined */
  code?: string | number
}

export function useMaterials(projectId: string) {
  const [tree, setTree] = useState<FileNode | null>(null)
  const [isTreeLoading, setIsTreeLoading] = useState(true)
  const [treeFailed, setTreeFailed] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<string[]>(DEFAULT_EXPANDED)
  const [loadingPaths, setLoadingPaths] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // 组件卸载后不再 setState
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /** 拉整棵树，展开状态保持不变 */
  const refreshTree = useCallback(async () => {
    if (!projectId)
      return

    setIsTreeLoading(true)
    try {
      const res = await getProjectFileTreeApi(projectId, { depth: PROJECT_FILE_TREE_MAX_DEPTH })
      if (!mountedRef.current)
        return

      if (res && res.code === 0 && res.data) {
        setTree(normalizeTreeResponse(res.data, ''))
        setTreeFailed(false)
      }
      else {
        setTree(null)
        setTreeFailed(true)
      }
    }
    catch (error) {
      console.error('Load project file tree failed:', error)
      if (mountedRef.current) {
        setTree(null)
        setTreeFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsTreeLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refreshTree()
  }, [refreshTree])

  /** 层数不够导致 children 为 null 的目录，展开时再单独拉一次 */
  const loadSubtree = useCallback(
    async (path: string) => {
      if (!projectId)
        return

      setLoadingPaths(prev => (prev.includes(path) ? prev : [...prev, path]))
      try {
        const res = await getProjectFileTreeApi(projectId, {
          path,
          depth: PROJECT_FILE_TREE_MAX_DEPTH,
        })
        if (!mountedRef.current)
          return

        if (res && res.code === 0 && res.data) {
          const subtree = normalizeTreeResponse(res.data, path)
          if (subtree) {
            setTree(prev => (prev ? replaceNodeByPath(prev, path, () => subtree) : prev))
          }
        }
      }
      catch (error) {
        console.error('Load project subtree failed:', error)
      }
      finally {
        if (mountedRef.current)
          setLoadingPaths(prev => prev.filter(item => item !== path))
      }
    },
    [projectId],
  )

  const isExpanded = useCallback(
    (path: string) => expandedPaths.includes(path),
    [expandedPaths],
  )

  const expandPath = useCallback(
    (node: FileNode) => {
      if (node.type !== ProjectFileType.Dir)
        return

      setExpandedPaths(prev => (prev.includes(node.path) ? prev : [...prev, node.path]))
      if (node.children === null)
        loadSubtree(node.path)
    },
    [loadSubtree],
  )

  /** 按路径展开（含所有上级），上传完要让新文件所在目录自己展开 */
  const expandDirPath = useCallback((path: string) => {
    const segments = path ? path.split('/') : []
    const paths: string[] = ['']
    segments.reduce((prefix, segment) => {
      const next = prefix ? `${prefix}/${segment}` : segment
      paths.push(next)
      return next
    }, '')

    setExpandedPaths(prev => Array.from(new Set([...prev, ...paths])))
  }, [])

  const toggleExpand = useCallback(
    (node: FileNode) => {
      if (node.type !== ProjectFileType.Dir)
        return

      setExpandedPaths((prev) => {
        if (prev.includes(node.path))
          return prev.filter(item => item !== node.path)

        if (node.children === null)
          loadSubtree(node.path)
        return [...prev, node.path]
      })
    },
    [loadSubtree],
  )

  /** 选中的节点，节点没了（比如刚被删）就当作没选中 */
  const selectedNode = selectedPath === null ? null : findNodeByPath(tree, selectedPath)

  const selectNode = useCallback((node: FileNode | null) => {
    setSelectedPath(node ? node.path : null)
  }, [])

  const selectPath = useCallback((path: string | null) => {
    setSelectedPath(path)
  }, [])

  const createFolder = useCallback(
    async (path: string): Promise<MaterialMutationResult> => {
      try {
        const res = await mkdirProjectFileApi(projectId, { path })
        if (res && res.code === 0) {
          await refreshTree()
          return { ok: true }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Create project folder failed:', error)
        return { ok: false }
      }
    },
    [projectId, refreshTree],
  )

  const renameNode = useCallback(
    async (from: string, to: string): Promise<MaterialMutationResult> => {
      try {
        const res = await renameProjectFileApi(projectId, { from, to })
        if (res && res.code === 0) {
          await refreshTree()
          setSelectedPath(prev => (prev === from ? to : prev))
          setExpandedPaths(prev => prev.map(item => (item === from ? to : item)))
          return { ok: true }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Rename project file failed:', error)
        return { ok: false }
      }
    },
    [projectId, refreshTree],
  )

  const deleteNode = useCallback(
    async (path: string): Promise<MaterialMutationResult> => {
      try {
        const res = await deleteProjectFileApi(projectId, { path })
        if (res && res.code === 0) {
          await refreshTree()
          setSelectedPath(prev => (prev === path || prev?.startsWith(`${path}/`) ? null : prev))
          setExpandedPaths(prev => prev.filter(item => item !== path && !item.startsWith(`${path}/`)))
          return { ok: true }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Delete project file failed:', error)
        return { ok: false }
      }
    },
    [projectId, refreshTree],
  )

  return {
    tree,
    isTreeLoading,
    treeFailed,
    loadingPaths,
    selectedNode,
    selectNode,
    selectPath,
    isExpanded,
    expandPath,
    expandDirPath,
    toggleExpand,
    refreshTree,
    createFolder,
    renameNode,
    deleteNode,
  }
}
