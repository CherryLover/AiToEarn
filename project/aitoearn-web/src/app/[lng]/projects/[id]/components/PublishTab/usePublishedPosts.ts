/**
 * usePublishedPosts - 发布记录列表
 * 记录是数据库里的，走 publishing 接口；草稿正文和配图仍旧是文件，不在这里读。
 */
'use client'

import type { PublishedPostListItem } from '@/api/publishing/publishing.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPublishedPostListApi } from '@/api/publishing/publishing.api'
import { PUBLISHED_POST_PAGE_SIZE } from '@/api/publishing/publishing.constants'

/**
 * 列表不带筛选：服务端支持按方向 / 平台 / 发布状态 / 链接状态筛（见 publishing.types 的列表参数），
 * 这一轮页面上只按时间倒着列，要筛的时候再把参数接上来。
 */
export function usePublishedPosts(projectId: string) {
  const [posts, setPosts] = useState<PublishedPostListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchPage = useCallback(
    async (targetPage: number) => {
      const res = await getPublishedPostListApi(projectId, {
        page: targetPage,
        pageSize: PUBLISHED_POST_PAGE_SIZE,
      })

      if (res && res.code === 0 && res.data) {
        return {
          list: Array.isArray(res.data.list) ? res.data.list : [],
          total: Number(res.data.total) || 0,
          totalPages: Number(res.data.totalPages) || 1,
        }
      }

      return null
    },
    [projectId],
  )

  const refresh = useCallback(async () => {
    if (!projectId)
      return

    setIsLoading(true)
    try {
      const data = await fetchPage(1)
      if (!mountedRef.current)
        return

      if (!data) {
        setPosts([])
        setTotal(0)
        setLoadFailed(true)
        return
      }

      setPosts(data.list)
      setTotal(data.total)
      setTotalPages(data.totalPages)
      setPage(1)
      setLoadFailed(false)
    }
    catch (error) {
      console.error('Load published posts failed:', error)
      if (mountedRef.current) {
        setPosts([])
        setTotal(0)
        setLoadFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsLoading(false)
    }
  }, [fetchPage, projectId])

  const loadMore = useCallback(async () => {
    if (isLoadingMore || page >= totalPages)
      return

    setIsLoadingMore(true)
    try {
      const next = page + 1
      const data = await fetchPage(next)
      if (!mountedRef.current || !data)
        return

      // 同一条可能因为翻页期间有新记录而重复，按 id 去重
      setPosts((prev) => {
        const seen = new Set(prev.map(item => item.id))
        return [...prev, ...data.list.filter(item => !seen.has(item.id))]
      })
      setTotal(data.total)
      setTotalPages(data.totalPages)
      setPage(next)
    }
    catch (error) {
      console.error('Load more published posts failed:', error)
    }
    finally {
      if (mountedRef.current)
        setIsLoadingMore(false)
    }
  }, [fetchPage, isLoadingMore, page, totalPages])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    posts,
    total,
    isLoading,
    isLoadingMore,
    loadFailed,
    hasMore: page < totalPages,
    refresh,
    loadMore,
  }
}
