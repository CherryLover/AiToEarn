/**
 * useAngles - 方向列表的状态与增删改
 * 一次把项目下**已确认**的方向全部拉回来，树和按状态分组都从这份数据算，
 * 改完状态不用重新请求也能立刻重排。
 *
 * AI 提炼出来的方向是待确认的，不在 `angles` 里，走 `usePendingAngles` 那一套单独拉，
 * 采用之后才会进到这份列表。两边分开是为了「待确认的不污染演进树和状态分组」。
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
  confirmAngleApi,
  confirmAnglesApi,
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

/** 组件卸载之后别再 setState，页面切走时接口刚好返回是常事 */
function useMountedRef() {
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return mountedRef
}

/**
 * 待确认区：AI 写进 angles/ 又被 `/sync` 登记进来、还没人点过采用的方向。
 *
 * 单独一个 hook 是为了让待确认区组件自包含——它只要这一份数据，
 * 不必把已确认的列表再拉一遍。`useAngles` 会把这里的状态和方法一并透出去。
 */
export function usePendingAngles(projectId: string) {
  const [pendingAngles, setPendingAngles] = useState<Angle[]>([])
  const [isPendingLoading, setIsPendingLoading] = useState(true)
  const [pendingLoadFailed, setPendingLoadFailed] = useState(false)

  const mountedRef = useMountedRef()

  const refreshPending = useCallback(async () => {
    if (!projectId)
      return

    setIsPendingLoading(true)
    try {
      const res = await getAngleListApi(projectId, { confirmed: false })
      if (!mountedRef.current)
        return

      if (res && res.code === 0 && Array.isArray(res.data)) {
        setPendingAngles(res.data)
        setPendingLoadFailed(false)
      }
      else {
        setPendingAngles([])
        setPendingLoadFailed(true)
      }
    }
    catch (error) {
      console.error('Load pending angles failed:', error)
      if (mountedRef.current) {
        setPendingAngles([])
        setPendingLoadFailed(true)
      }
    }
    finally {
      if (mountedRef.current)
        setIsPendingLoading(false)
    }
  }, [mountedRef, projectId])

  useEffect(() => {
    refreshPending()
  }, [refreshPending])

  /** 采用一条：成功之后它就不再是待确认的了，从待确认区里摘掉 */
  const confirm = useCallback(
    async (angleId: string): Promise<AngleMutationResult> => {
      try {
        const res = await confirmAngleApi(projectId, angleId)
        if (res && res.code === 0) {
          if (mountedRef.current)
            setPendingAngles(prev => prev.filter(item => item.id !== angleId))

          return { ok: true, angle: res.data ?? undefined }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Confirm angle failed:', error)
        return { ok: false }
      }
    },
    [mountedRef, projectId],
  )

  /** 批量采用（「全部采用」走这里）。服务端整单成功或整单失败，不会采用一半 */
  const confirmMany = useCallback(
    async (angleIds: string[]): Promise<AngleMutationResult> => {
      if (angleIds.length === 0)
        return { ok: true }

      try {
        const res = await confirmAnglesApi(projectId, { angleIds })
        if (res && res.code === 0) {
          const confirmed = new Set(angleIds)
          if (mountedRef.current)
            setPendingAngles(prev => prev.filter(item => !confirmed.has(item.id)))

          return { ok: true }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Confirm angles failed:', error)
        return { ok: false }
      }
    },
    [mountedRef, projectId],
  )

  /** 采用之前先把 AI 起的名字和说明改顺眼；改完还留在待确认区 */
  const updatePending = useCallback(
    async (angleId: string, data: UpdateAngleParams): Promise<AngleMutationResult> => {
      try {
        const res = await updateAngleApi(projectId, angleId, data)
        if (res && res.code === 0) {
          if (res.data && mountedRef.current) {
            const next = res.data
            setPendingAngles(prev => prev.map(item => (item.id === angleId ? next : item)))
          }
          else {
            await refreshPending()
          }
          return { ok: true, angle: res.data ?? undefined }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Update pending angle failed:', error)
        return { ok: false }
      }
    },
    [mountedRef, projectId, refreshPending],
  )

  /** 不要的直接删掉，连 angles/<slug>.md 一起 */
  const removePending = useCallback(
    async (angleId: string): Promise<AngleMutationResult> => {
      try {
        const res = await deleteAngleApi(projectId, angleId)
        if (res && res.code === 0) {
          if (mountedRef.current)
            setPendingAngles(prev => prev.filter(item => item.id !== angleId))

          return { ok: true }
        }
        return { ok: false, code: res?.code }
      }
      catch (error) {
        console.error('Delete pending angle failed:', error)
        return { ok: false }
      }
    },
    [mountedRef, projectId],
  )

  return {
    pendingAngles,
    isPendingLoading,
    pendingLoadFailed,
    refreshPending,
    confirm,
    confirmMany,
    updatePending,
    removePending,
  }
}

export function useAngles(projectId: string) {
  const [angles, setAngles] = useState<Angle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  const pending = usePendingAngles(projectId)
  const { refreshPending } = pending

  const mountedRef = useMountedRef()

  const refresh = useCallback(async () => {
    if (!projectId)
      return

    setIsLoading(true)
    try {
      // 只要已确认的：待确认的归待确认区，别混进演进树和状态分组
      const res = await getAngleListApi(projectId, { confirmed: true })
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
  }, [mountedRef, projectId])

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
    [mountedRef, projectId, refresh],
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
   * AI 技能只写文件不写库，少了这一步，提炼出来的方向永远不会出现在页面上。
   *
   * 登记进来的是**待确认**的，所以接口返回的全量列表不能直接拿来换掉 `angles`
   * （那样待确认的就混进演进树了）：登记完两份各自重拉一次。
   */
  const sync = useCallback(async (): Promise<AngleMutationResult> => {
    try {
      const res = await syncAnglesApi(projectId)
      if (res && res.code === 0 && Array.isArray(res.data)) {
        await Promise.all([refresh(), refreshPending()])
        return { ok: true }
      }
      return { ok: false, code: res?.code }
    }
    catch (error) {
      console.error('Sync angles from files failed:', error)
      return { ok: false }
    }
  }, [projectId, refresh, refreshPending])

  return {
    angles,
    isLoading,
    loadFailed,
    refresh,
    sync,
    create,
    derive,
    update,
    remove,
    ...pending,
  }
}
