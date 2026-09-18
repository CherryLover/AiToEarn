/**
 * useMaterialUpload - 物料上传队列
 * 一次可以拖多个文件，逐个上传，每个都有进度和取消。
 */
'use client'

import { useCallback, useRef, useState } from 'react'
import { uploadProjectFileApi } from '@/api/projects/project-file.api'
import { PROJECT_FILE_UPLOAD_MAX_SIZE } from '@/api/projects/project-file.constants'
import { getProjectErrorKey } from '../../../projects.utils'

export type UploadItemStatus = 'pending' | 'uploading' | 'done' | 'error' | 'canceled'

export interface UploadItem {
  id: string
  name: string
  size: number
  /** 目标目录，相对项目根 */
  targetDir: string
  /** 0~100 */
  progress: number
  status: UploadItemStatus
  /** 失败时的文案键，projects 命名空间 */
  errorKey?: string
}

let uploadSeq = 0

function nextUploadId() {
  uploadSeq += 1
  return `upload-${Date.now()}-${uploadSeq}`
}

export function useMaterialUpload(projectId: string, onUploaded: (targetDir: string) => void) {
  const [items, setItems] = useState<UploadItem[]>([])
  // 队列要在异步循环里读最新状态，用 ref 做一份镜像，别在 setState 回调里做副作用
  const itemsRef = useRef<UploadItem[]>([])
  const controllersRef = useRef(new Map<string, AbortController>())

  const updateItems = useCallback((updater: (prev: UploadItem[]) => UploadItem[]) => {
    itemsRef.current = updater(itemsRef.current)
    setItems(itemsRef.current)
  }, [])

  const patchItem = useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      updateItems(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)))
    },
    [updateItems],
  )

  /** 把一批文件排进队列并逐个上传 */
  const enqueue = useCallback(
    async (files: File[], targetDir: string) => {
      if (files.length === 0)
        return

      const queued: UploadItem[] = files.map((file) => {
        const tooLarge = file.size > PROJECT_FILE_UPLOAD_MAX_SIZE
        return {
          id: nextUploadId(),
          name: file.name,
          size: file.size,
          targetDir,
          progress: 0,
          status: tooLarge ? ('error' as UploadItemStatus) : ('pending' as UploadItemStatus),
          errorKey: tooLarge ? 'materials.upload.tooLarge' : undefined,
        }
      })

      updateItems(prev => [...prev, ...queued])

      let uploadedAny = false

      for (let index = 0; index < files.length; index += 1) {
        const queuedItem = queued[index]
        // 排队期间可能已经被取消或被判定超限
        const current = itemsRef.current.find(item => item.id === queuedItem.id)
        if (!current || current.status !== 'pending')
          continue

        const controller = new AbortController()
        controllersRef.current.set(queuedItem.id, controller)
        patchItem(queuedItem.id, { status: 'uploading' })

        try {
          const res = await uploadProjectFileApi(projectId, files[index], {
            path: targetDir,
            signal: controller.signal,
            onProgress: progress => patchItem(queuedItem.id, { progress }),
          })

          if (res && res.code === 0) {
            uploadedAny = true
            patchItem(queuedItem.id, { status: 'done', progress: 100 })
          }
          else {
            patchItem(queuedItem.id, { status: 'error', errorKey: getProjectErrorKey(res?.code) })
          }
        }
        catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            patchItem(queuedItem.id, { status: 'canceled' })
          }
          else {
            console.error('Upload project file failed:', error)
            patchItem(queuedItem.id, { status: 'error', errorKey: 'error.network' })
          }
        }
        finally {
          controllersRef.current.delete(queuedItem.id)
        }
      }

      if (uploadedAny)
        onUploaded(targetDir)
    },
    [onUploaded, patchItem, projectId, updateItems],
  )

  const cancel = useCallback(
    (id: string) => {
      const controller = controllersRef.current.get(id)
      // 正在传的中断请求，还没轮到的直接置为取消，队列跑到它时会跳过
      if (controller)
        controller.abort()
      else
        patchItem(id, { status: 'canceled' })
    },
    [patchItem],
  )

  const cancelAll = useCallback(() => {
    controllersRef.current.forEach(controller => controller.abort())
    updateItems(prev =>
      prev.map(item =>
        item.status === 'pending' || item.status === 'uploading'
          ? { ...item, status: 'canceled' as UploadItemStatus }
          : item,
      ),
    )
  }, [updateItems])

  /** 清掉已经结束的记录，正在传的留着 */
  const clearFinished = useCallback(() => {
    updateItems(prev =>
      prev.filter(item => item.status === 'pending' || item.status === 'uploading'),
    )
  }, [updateItems])

  const isUploading = items.some(item => item.status === 'pending' || item.status === 'uploading')

  return { items, enqueue, cancel, cancelAll, clearFinished, isUploading }
}
