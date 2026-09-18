/**
 * MaterialsTab - 项目详情页「物料」标签页
 * 左边目录树，右边内容区；支持拖拽上传、文本编辑、图片预览、改名与删除
 */
'use client'

import type { NameDialogState } from './NameDialog'
import type { FileNode } from '@/api/projects/project-file.types'
import { FolderPlus, RefreshCw, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { ProjectFileType } from '@/api/projects/project-file.types'
import { useTransClient } from '@/app/i18n/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { getProjectErrorKey } from '../../../projects.utils'
import { DirectoryPanel } from './DirectoryPanel'
import { FileContentPanel } from './FileContentPanel'
import { FileTree } from './FileTree'
import { getParentPath, joinMaterialPath } from './materials.utils'
import { MaterialsOverview } from './MaterialsOverview'
import { NameDialog } from './NameDialog'
import { UploadQueue } from './UploadQueue'
import { useMaterials } from './useMaterials'
import { useMaterialUpload } from './useMaterialUpload'

interface MaterialsTabProps {
  projectId: string
  /** 归档项目只读 */
  readOnly: boolean
}

export function MaterialsTab({ projectId, readOnly }: MaterialsTabProps) {
  const { t } = useTransClient('projects')

  const {
    tree,
    isTreeLoading,
    treeFailed,
    loadingPaths,
    selectedNode,
    selectNode,
    selectPath,
    isExpanded,
    expandDirPath,
    toggleExpand,
    refreshTree,
    createFolder,
    renameNode,
    deleteNode,
  } = useMaterials(projectId)

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileNode | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 拖拽进出子元素会连续触发 dragleave，用计数器判断真正离开
  const dragDepthRef = useRef(0)

  /** 上传落点：选中目录就是它，选中文件就是它所在目录，什么都没选就是项目根 */
  const targetDir = !selectedNode
    ? ''
    : selectedNode.type === ProjectFileType.Dir
      ? selectedNode.path
      : getParentPath(selectedNode.path)

  const handleUploaded = useCallback(
    (dir: string) => {
      // 刷新后展开落点目录，图片的名片文件就在树里看得见
      refreshTree()
      expandDirPath(dir)
    },
    [expandDirPath, refreshTree],
  )

  const { items, enqueue, cancel, cancelAll, clearFinished, isUploading } = useMaterialUpload(
    projectId,
    handleUploaded,
  )

  const handlePickFiles = () => {
    fileInputRef.current?.click()
  }

  const handleFilesChosen = (files: FileList | null) => {
    if (!files || files.length === 0)
      return
    enqueue(Array.from(files), targetDir)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragging(false)
    if (readOnly)
      return
    handleFilesChosen(event.dataTransfer.files)
  }

  const handleNameSubmit = async (state: NameDialogState, name: string) => {
    if (state.mode === 'create-folder') {
      const result = await createFolder(joinMaterialPath(state.path, name))
      if (result.ok) {
        toast.success(t('materials.newFolder.success'))
        expandDirPath(state.path)
        return true
      }
      toast.error(t(getProjectErrorKey(result.code)))
      return false
    }

    const to = joinMaterialPath(getParentPath(state.path), name)
    if (to === state.path)
      return true

    const result = await renameNode(state.path, to)
    if (result.ok) {
      toast.success(t('materials.rename.success'))
      return true
    }
    toast.error(t(getProjectErrorKey(result.code)))
    return false
  }

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting)
      return

    setIsDeleting(true)
    try {
      const result = await deleteNode(deleteTarget.path)
      if (result.ok) {
        toast.success(t('materials.delete.success'))
        setDeleteTarget(null)
        return
      }
      toast.error(t(getProjectErrorKey(result.code)))
    }
    finally {
      setIsDeleting(false)
    }
  }

  if (isTreeLoading && !tree) {
    return (
      <div className="mt-4 grid gap-4 md:grid-cols-[18rem_1fr]">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  }

  if (treeFailed || !tree) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
        <h3 className="text-base font-medium text-foreground">{t('materials.tree.loadFailed')}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {t('materials.tree.loadFailedDesc')}
        </p>
        <Button className="mt-6" variant="outline" onClick={refreshTree}>
          <RefreshCw className="size-4" />
          {t('action.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div
      className="mt-4"
      onDragEnter={(event) => {
        if (readOnly)
          return
        event.preventDefault()
        dragDepthRef.current += 1
        setIsDragging(true)
      }}
      onDragOver={(event) => {
        if (!readOnly)
          event.preventDefault()
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0)
          setIsDragging(false)
      }}
      onDrop={handleDrop}
    >
      <div
        className={cn(
          'grid gap-4 rounded-xl md:grid-cols-[18rem_1fr]',
          isDragging && 'outline-dashed outline-2 outline-offset-4 outline-brand-cyan/60',
        )}
      >
        {/* 左：目录树 */}
        <aside className="flex max-h-[32rem] min-h-[18rem] flex-col rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-2">
            <span className="px-1 text-xs font-medium text-muted-foreground">
              {t('materials.tree.title')}
            </span>
            <div className="flex items-center gap-1">
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('materials.menu.newFolder')}
                  onClick={() => setNameDialog({ mode: 'create-folder', path: targetDir, initialName: '' })}
                >
                  <FolderPlus className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('action.refresh')}
                disabled={isTreeLoading}
                onClick={refreshTree}
              >
                <RefreshCw className={isTreeLoading ? 'size-4 animate-spin' : 'size-4'} />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            <FileTree
              root={tree}
              selectedPath={selectedNode?.path ?? null}
              loadingPaths={loadingPaths}
              readOnly={readOnly}
              isExpanded={isExpanded}
              onSelect={selectNode}
              onToggle={toggleExpand}
              onCreateFolder={path => setNameDialog({ mode: 'create-folder', path, initialName: '' })}
              onRename={node =>
                setNameDialog({ mode: 'rename', path: node.path, initialName: node.name })}
              onDelete={node => setDeleteTarget(node)}
            />
          </div>

          {!readOnly && (
            <div className="border-t border-border p-2">
              <Button variant="outline" size="sm" className="w-full" onClick={handlePickFiles}>
                <Upload className="size-4" />
                {t('materials.action.uploadTo', { dir: targetDir || '/', interpolation: { escapeValue: false } })}
              </Button>
            </div>
          )}
        </aside>

        {/* 右：内容区 */}
        <section className="flex max-h-[32rem] min-h-[18rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="min-h-0 flex-1 overflow-auto">
            {!selectedNode ? (
              <MaterialsOverview
                tree={tree}
                readOnly={readOnly}
                onOpenDir={(path) => {
                  selectPath(path)
                  expandDirPath(path)
                }}
                onPickFiles={handlePickFiles}
              />
            ) : selectedNode.type === ProjectFileType.Dir ? (
              <DirectoryPanel
                node={selectedNode}
                readOnly={readOnly}
                onSelect={selectNode}
                onCreateFolder={path => setNameDialog({ mode: 'create-folder', path, initialName: '' })}
                onPickFiles={handlePickFiles}
              />
            ) : (
              <FileContentPanel
                key={selectedNode.path}
                projectId={projectId}
                node={selectedNode}
                readOnly={readOnly}
                onSaved={refreshTree}
              />
            )}
          </div>
        </section>
      </div>

      {!readOnly && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('materials.upload.dropHint', { dir: targetDir || '/', interpolation: { escapeValue: false } })}
        </p>
      )}

      <UploadQueue
        items={items}
        isUploading={isUploading}
        onCancel={cancel}
        onCancelAll={cancelAll}
        onClearFinished={clearFinished}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          handleFilesChosen(event.target.files)
          // 同一个文件连续选两次也要能触发 change
          event.target.value = ''
        }}
      />

      <NameDialog
        state={nameDialog}
        onOpenChange={open => !open && setNameDialog(null)}
        onSubmit={handleNameSubmit}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('materials.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === ProjectFileType.Dir
                ? t('materials.delete.dirDesc', { path: deleteTarget?.path, interpolation: { escapeValue: false } })
                : t('materials.delete.fileDesc', { path: deleteTarget?.path, interpolation: { escapeValue: false } })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('materials.delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // 等请求回来再关，别提前把弹窗收掉
                event.preventDefault()
                handleDelete()
              }}
            >
              {isDeleting ? t('materials.delete.deleting') : t('materials.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
