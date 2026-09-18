import type {
  DeleteProjectFileParams,
  FileContent,
  FileNode,
  MkdirProjectFileParams,
  ProjectFileApiResponse,
  ProjectFileDeleted,
  ProjectFileTreeParams,
  RenameProjectFileParams,
  UploadProjectFileOptions,
  WriteProjectFileParams,
} from './project-file.types'
import { useUserStore } from '@/store/user'
import http from '@/utils/request'

/** 上传与下载不走统一 http 封装（要进度、要二进制），这里自己拼请求地址 */
function getProjectFileUrl(id: string, action: string, params?: Record<string, string>) {
  const base = `${process.env.NEXT_PUBLIC_API_URL || '/api'}/projects/${id}/files/${action}`
  if (!params)
    return base

  const search = new URLSearchParams(params).toString()
  return search ? `${base}?${search}` : base
}

/** 与 utils/request 的请求拦截器保持一致：Bearer token + 语言头 */
function getProjectFileHeaders() {
  const { token, lang } = useUserStore.getState()
  const headers: Record<string, string> = {
    Authorization: token ? `Bearer ${token}` : '',
  }
  if (lang)
    headers['Accept-Language'] = lang

  return headers
}

/**
 * 目录树。path 相对项目根，不传为根；depth 默认 3，最大 10。
 */
export function getProjectFileTreeApi(id: string, params?: ProjectFileTreeParams, silent = true) {
  return http.get<FileNode>(`projects/${id}/files/tree`, params, silent)
}

/**
 * 读文本文件。二进制或超过 1 MB 的文件服务端会拒绝，要走下载。
 */
export function readProjectFileApi(id: string, path: string, silent = true) {
  return http.get<FileContent>(`projects/${id}/files/read`, { path }, silent)
}

/**
 * 写文本文件，目标不存在时新建。
 */
export function writeProjectFileApi(id: string, data: WriteProjectFileParams, silent = true) {
  return http.post<FileContent>(`projects/${id}/files/write`, data, silent)
}

/**
 * 新建文件夹。
 */
export function mkdirProjectFileApi(id: string, data: MkdirProjectFileParams, silent = true) {
  return http.post<FileNode>(`projects/${id}/files/mkdir`, data, silent)
}

/**
 * 改名 / 移动。
 */
export function renameProjectFileApi(id: string, data: RenameProjectFileParams, silent = true) {
  return http.post<FileNode>(`projects/${id}/files/rename`, data, silent)
}

/**
 * 删除文件或目录。
 */
export function deleteProjectFileApi(id: string, data: DeleteProjectFileParams, silent = true) {
  return http.post<ProjectFileDeleted>(`projects/${id}/files/delete`, data, silent)
}

/**
 * 上传文件到指定目录。
 * 走 XMLHttpRequest 而不是统一的 http 封装：fetch 拿不到上传进度，也不好中途取消。
 * 参照 api/materials/material.api.ts 里 uploadToOss 的写法。
 */
export function uploadProjectFileApi(
  id: string,
  file: File,
  options: UploadProjectFileOptions,
): Promise<ProjectFileApiResponse<FileNode>> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('上传已取消', 'AbortError'))
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('path', options.path)

    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable)
        options.onProgress?.(Math.round((event.loaded / event.total) * 100))
    })

    const handleAbort = () => {
      xhr.abort()
      reject(new DOMException('上传已取消', 'AbortError'))
    }

    options.signal?.addEventListener('abort', handleAbort, { once: true })

    xhr.addEventListener('load', () => {
      options.signal?.removeEventListener('abort', handleAbort)
      try {
        resolve(JSON.parse(xhr.responseText) as ProjectFileApiResponse<FileNode>)
      }
      catch {
        reject(new Error(`上传失败: ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => {
      options.signal?.removeEventListener('abort', handleAbort)
      reject(new Error('上传失败: 网络错误'))
    })

    xhr.open('POST', getProjectFileUrl(id, 'upload'))
    const headers = getProjectFileHeaders()
    Object.entries(headers).forEach(([key, value]) => {
      if (value)
        xhr.setRequestHeader(key, value)
    })
    // 不设置 Content-Type，交给浏览器带 boundary
    xhr.send(formData)
  })
}

/**
 * 下载原件，返回 Blob。图片预览取不到名片里的 OSS 地址时也走这里。
 */
export async function downloadProjectFileApi(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(getProjectFileUrl(id, 'download', { path }), {
    method: 'GET',
    headers: getProjectFileHeaders(),
    signal,
  })

  if (!response.ok)
    throw new Error(`Download failed: ${response.status}`)

  return response.blob()
}
