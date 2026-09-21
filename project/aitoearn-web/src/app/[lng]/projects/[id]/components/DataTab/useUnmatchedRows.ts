/**
 * useUnmatchedRows - 落地表里还没归属的那些行
 *
 * 用户账号里可能有几十条帖子，只有几条属于这个项目。没归属不是错误，是常态——
 * 这一块的作用是让人把真正属于某个项目的那几条认领过去。
 */
'use client'

import type { AdoptCreatorNoteRowParams, CreatorNoteRow } from '@/api/creator-notes/creator-notes.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { adoptCreatorNoteRowApi, claimCreatorNoteRowApi, getCreatorNoteRowListApi } from '@/api/creator-notes/creator-notes.api'
import { CREATOR_NOTE_ROW_PAGE_SIZE } from '@/api/creator-notes/creator-notes.constants'
import { MatchState } from '@/api/creator-notes/creator-notes.types'

export function useUnmatchedRows(projectId: string) {
  const [rows, setRows] = useState<CreatorNoteRow[]>([])
  const [total, setTotal] = useState(0)
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
    setIsLoading(true)
    try {
      // 待定（ambiguous）的也一起列出来：它们同样需要人来定夺，
      // 分成两块只会让人以为「待定」是系统还在处理
      const [unmatched, ambiguous] = await Promise.all([
        getCreatorNoteRowListApi({ matchState: MatchState.Unmatched, pageSize: CREATOR_NOTE_ROW_PAGE_SIZE }),
        getCreatorNoteRowListApi({ matchState: MatchState.Ambiguous, pageSize: CREATOR_NOTE_ROW_PAGE_SIZE }),
      ])

      if (!mountedRef.current)
        return

      const list = [
        ...(Array.isArray(ambiguous?.data?.list) ? ambiguous.data.list : []),
        ...(Array.isArray(unmatched?.data?.list) ? unmatched.data.list : []),
      ]

      setRows(list)
      setTotal((Number(unmatched?.data?.total) || 0) + (Number(ambiguous?.data?.total) || 0))
      setLoadFailed(unmatched?.code !== 0 || ambiguous?.code !== 0)
    }
    catch (error) {
      console.error('Load unmatched creator note rows failed:', error)
      if (mountedRef.current) {
        setRows([])
        setTotal(0)
        setLoadFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsLoading(false)
    }
  }, [])

  /** 认领成功的那一行立刻从「未归属」里拿掉，不等整块刷新 */
  const drop = useCallback((rowId: string) => {
    if (!mountedRef.current)
      return

    setRows(current => current.filter(row => row.id !== rowId))
    setTotal(current => Math.max(0, current - 1))
  }, [])

  const claim = useCallback(async (rowId: string, publishedPostId: string) => {
    const res = await claimCreatorNoteRowApi(rowId, publishedPostId)
    if (res?.code !== 0)
      return false

    drop(rowId)
    return true
  }, [drop])

  const adopt = useCallback(async (rowId: string, params: Omit<AdoptCreatorNoteRowParams, 'projectId'>) => {
    const res = await adoptCreatorNoteRowApi(rowId, { ...params, projectId })
    if (res?.code !== 0)
      return false

    drop(rowId)
    return true
  }, [drop, projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { rows, total, isLoading, loadFailed, refresh, claim, adopt }
}
