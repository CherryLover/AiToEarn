/**
 * useDrafts - 草稿列表
 * 草稿是文件不是表，列表直接从 drafts/ 目录树里认出来，走阶段 1 的文件接口。
 */
'use client'

import type { DraftItem } from './drafts.utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getProjectFileTreeApi } from '@/api/projects/project-file.api'
import { PROJECT_FILE_ERROR_CODE } from '@/api/projects/project-file.constants'
import { DRAFT_TREE_DEPTH, DRAFTS_DIR } from './drafts.constants'
import { collectDrafts } from './drafts.utils'

export function useDrafts(projectId: string) {
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!projectId)
      return

    setIsLoading(true)
    try {
      const res = await getProjectFileTreeApi(projectId, {
        path: DRAFTS_DIR,
        depth: DRAFT_TREE_DEPTH,
      })
      if (!mountedRef.current)
        return

      if (res && res.code === 0 && res.data) {
        setDrafts(collectDrafts(res.data))
        setLoadFailed(false)
        return
      }

      // drafts 目录还没建出来不算出错，就是还没生成过内容
      if (Number(res?.code) === PROJECT_FILE_ERROR_CODE.NotFound) {
        setDrafts([])
        setLoadFailed(false)
        return
      }

      setDrafts([])
      setLoadFailed(true)
    }
    catch (error) {
      console.error('Load project drafts failed:', error)
      if (mountedRef.current) {
        setDrafts([])
        setLoadFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { drafts, isLoading, loadFailed, refresh }
}
