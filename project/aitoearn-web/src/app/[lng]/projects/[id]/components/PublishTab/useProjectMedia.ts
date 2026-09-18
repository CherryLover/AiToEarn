/**
 * useProjectMedia - 项目 media/ 目录里的图片
 * 列出有哪些图（走阶段 1 的物料文件接口），再按需把一张图解析成能显示的地址：
 * 名片里有 OSS 地址就用 OSS，没有就下载原件生成 blob 地址。
 *
 * 这只是「把项目里已有的图翻出来给人挑」，挑完摆在发布卡片上让人自己复制 / 下载。
 * 这里不写任何文件，也不往任何平台发东西。
 */
'use client'

import type { FileNode } from '@/api/projects/project-file.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadProjectFileApi,
  getProjectFileTreeApi,
  readProjectFileApi,
} from '@/api/projects/project-file.api'
import {
  getImageCardPathCandidates,
  normalizeTreeResponse,
  parseFrontMatter,
} from '../MaterialsTab/materials.utils'
import {
  MEDIA_LIBRARY_DIR,
  MEDIA_LIBRARY_MAX_FILES,
  MEDIA_LIBRARY_TREE_DEPTH,
} from './publish.constants'
import { collectMediaImages } from './publish.utils'

/** 一张图解析出来的可显示地址 */
export interface MediaPreview {
  /** 能直接放进 img 的地址：OSS 地址或本地 blob 地址 */
  url: string
  /** 名片里的 OSS 地址，没有就是空串 */
  ossUrl: string
}

export interface ProjectMediaLibrary {
  files: FileNode[]
  isLoading: boolean
  loadFailed: boolean
  /** 图太多被截断了，只列出了前面一批 */
  truncated: boolean
  /** 已经解析出地址的图，按相对项目根的路径索引 */
  previews: Record<string, MediaPreview>
  /** 解析失败的图，按路径索引 */
  failed: Record<string, true>
  /** 重新列一次 media/ */
  load: () => Promise<void>
  /** 解析一张图的可显示地址，已经解析过的直接给回来，同一张并发只跑一次 */
  resolve: (path: string) => Promise<MediaPreview | null>
}

export function useProjectMedia(projectId: string): ProjectMediaLibrary {
  const [files, setFiles] = useState<FileNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [previews, setPreviews] = useState<Record<string, MediaPreview>>({})
  const [failed, setFailed] = useState<Record<string, true>>({})

  // 状态的镜像：解析时要同步判断有没有解析过，不能等下一次渲染
  const previewsRef = useRef<Record<string, MediaPreview>>({})
  const failedRef = useRef<Record<string, true>>({})
  const inflightRef = useRef(new Map<string, Promise<MediaPreview | null>>())
  // 下载原件预览生成的 blob 地址，卡片收起来时统一回收
  const objectUrlsRef = useRef<string[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
      objectUrlsRef.current = []
    }
  }, [])

  const load = useCallback(async () => {
    if (!projectId)
      return

    setIsLoading(true)
    setLoadFailed(false)
    try {
      const res = await getProjectFileTreeApi(projectId, {
        path: MEDIA_LIBRARY_DIR,
        depth: MEDIA_LIBRARY_TREE_DEPTH,
      })
      if (!mountedRef.current)
        return

      if (res && res.code === 0 && res.data) {
        const root = normalizeTreeResponse(res.data, MEDIA_LIBRARY_DIR)
        const result = collectMediaImages(root, MEDIA_LIBRARY_MAX_FILES)
        setFiles(result.files)
        setTruncated(result.truncated)
        return
      }

      // media/ 还没建出来也会走到这儿，按「没有图」处理，不是错误
      setFiles([])
      setTruncated(false)
      setLoadFailed(true)
    }
    catch (error) {
      console.error('Load project media failed:', error)
      if (mountedRef.current) {
        setFiles([])
        setTruncated(false)
        setLoadFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsLoading(false)
    }
  }, [projectId])

  const rememberPreview = useCallback((path: string, preview: MediaPreview) => {
    previewsRef.current = { ...previewsRef.current, [path]: preview }
    setPreviews(previewsRef.current)
  }, [])

  const rememberFailure = useCallback((path: string) => {
    failedRef.current = { ...failedRef.current, [path]: true }
    setFailed(failedRef.current)
  }, [])

  /**
   * 一张图解析成能显示的地址：先找名片里的 OSS 地址，找不到再下载原件。
   * 和草稿详情、物料预览是同一套路子，不另起一套。
   */
  const runResolve = useCallback(
    async (path: string): Promise<MediaPreview | null> => {
      try {
        for (const candidate of getImageCardPathCandidates(path)) {
          const res = await readProjectFileApi(projectId, candidate)
          if (!mountedRef.current)
            return null

          if (res && res.code === 0 && res.data) {
            const meta = parseFrontMatter(res.data.content)
            if (meta.oss) {
              const preview = { url: meta.oss, ossUrl: meta.oss }
              rememberPreview(path, preview)
              return preview
            }
            // 名片在但没传上 OSS：退回下载原件，本地预览照样看得见
            break
          }
        }

        const blob = await downloadProjectFileApi(projectId, path)
        if (!mountedRef.current)
          return null

        const url = URL.createObjectURL(blob)
        objectUrlsRef.current.push(url)
        const preview = { url, ossUrl: '' }
        rememberPreview(path, preview)
        return preview
      }
      catch (error) {
        console.error('Resolve project media preview failed:', error)
        if (mountedRef.current)
          rememberFailure(path)
        return null
      }
    },
    [projectId, rememberFailure, rememberPreview],
  )

  const resolve = useCallback(
    (path: string): Promise<MediaPreview | null> => {
      const cached = previewsRef.current[path]
      if (cached)
        return Promise.resolve(cached)

      if (failedRef.current[path])
        return Promise.resolve(null)

      const running = inflightRef.current.get(path)
      if (running)
        return running

      const task = runResolve(path).finally(() => inflightRef.current.delete(path))
      inflightRef.current.set(path, task)
      return task
    },
    [runResolve],
  )

  return { files, isLoading, loadFailed, truncated, previews, failed, load, resolve }
}
