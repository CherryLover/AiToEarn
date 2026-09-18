/**
 * useAngles - 方向列表的状态与增删改
 * 一次把项目下的方向全部拉回来，树和按状态分组都从这份数据算，
 * 改完状态不用重新请求也能立刻重排。
 */
'use client'

import type {
  Angle,
  CreateAngleParams,
  DeriveAngleParams,
  UpdateAngleParams,
} from '@/api/angles/angle.types'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createAngleApi,
  deleteAngleApi,
  deriveAngleApi,
  getAngleListApi,
  syncAnglesApi,
  updateAngleApi,
} from '@/api/angles/angle.api'

export interface AngleMutationResult {
  ok: boolean
  /** 失败时服务端返回的业务码，请求本身没通时为 undefined */
  code?: string | number
  /** 成功时的最新数据 */
  angle?: Angle
}

export function useAngles(projectId: string) {
  const [angles, setAngles] = useState<Angle[]>([])
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
      const res = await getAngleListApi(projectId)
      if (!mountedRef.current)
        return

      if (res && res.code === 0 && Array.isArray(res.data)) {
        setAngles(res.data)
        setLoadFailed(false)
      }
      else {
        setAngles([])
        setLoadFailed(true)
      }
    }
    catch (error) {
      console.error('Load project angles failed:', error)
      if (mountedRef.current) {
        setAngles([])
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

  const create = useCallback(
    async (data: CreateAngleParams): Promise<AngleMutationResult> => {
      try {
        const res = await createAngleApi(projectId, data)
        if (res && res.code === 0) {
          await refresh()
          return { ok: true, angle: res.data ?? undefined }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Create angle failed:', error)
        return { ok: false }
      }
    },
    [projectId, refresh],
  )

  const derive = useCallback(
    async (parentId: string, data: DeriveAngleParams): Promise<AngleMutationResult> => {
      try {
        const res = await deriveAngleApi(projectId, parentId, data)
        if (res && res.code === 0) {
          await refresh()
          return { ok: true, angle: res.data ?? undefined }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Derive angle failed:', error)
        return { ok: false }
      }
    },
    [projectId, refresh],
  )

  const update = useCallback(
    async (angleId: string, data: UpdateAngleParams): Promise<AngleMutationResult> => {
      try {
        const res = await updateAngleApi(projectId, angleId, data)
        if (res && res.code === 0) {
          // 服务端回了最新的就地替换，没回就整份重拉，避免页面显示的和库里对不上
          if (res.data && mountedRef.current) {
            const next = res.data
            setAngles(prev => prev.map(item => (item.id === angleId ? next : item)))
          }
          else {
            await refresh()
          }
          return { ok: true, angle: res.data ?? undefined }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Update angle failed:', error)
        return { ok: false }
      }
    },
    [projectId, refresh],
  )

  const remove = useCallback(
    async (angleId: string): Promise<AngleMutationResult> => {
      try {
        const res = await deleteAngleApi(projectId, angleId)
        if (res && res.code === 0) {
          await refresh()
          return { ok: true }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Delete angle failed:', error)
        return { ok: false }
      }
    },
    [projectId, refresh],
  )

  /**
   * 把 AI 写进 angles/ 的方向文件登记进数据库。
   * AI 技能只写文件不写库，少了这一步，提炼出来的方向永远不会出现在列表里。
   * 接口返回的就是登记之后的全量方向，直接拿来换掉列表，不用再拉一次。
   */
  const sync = useCallback(async (): Promise<AngleMutationResult> => {
    try {
      const res = await syncAnglesApi(projectId)
      if (res && res.code === 0 && Array.isArray(res.data)) {
        if (mountedRef.current) {
          setAngles(res.data)
          setLoadFailed(false)
        }
        return { ok: true }
      }
      return { ok: false, code: res?.code }
    }
    catch (error) {
      console.error('Sync angles from files failed:', error)
      return { ok: false }
    }
  }, [projectId])

  return { angles, isLoading, loadFailed, refresh, sync, create, derive, update, remove }
}
