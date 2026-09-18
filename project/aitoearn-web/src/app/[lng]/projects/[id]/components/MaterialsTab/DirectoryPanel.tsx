/**
 * DirectoryPanel - 选中目录时的右侧内容区
 * 顶上说清楚这个目录该放什么，下面列出里面已有的材料，空目录直接给引导
 */
'use client'

import type { FileNode } from '@/api/projects/project-file.types'
import { File as FileIcon, FolderClosed, FolderPlus, Image as ImageIcon, Inbox, Upload } from 'lucide-react'
import { ProjectFileType } from '@/api/projects/project-file.types'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { formatDate, formatFileSize } from '@/utils/format'
import {
  countMaterialFiles,
  getDirGuideKey,
  getVisibleChildren,
  isImageFileName,
} from './materials.utils'

interface DirectoryPanelProps {
  node: FileNode
  readOnly: boolean
  onSelect: (child: FileNode) => void
  onCreateFolder: (parentPath: string) => void
  onPickFiles: () => void
}

export function DirectoryPanel({ node, readOnly, onSelect, onCreateFolder, onPickFiles }: DirectoryPanelProps) {
  const { t } = useTransClient('projects')

  const children = getVisibleChildren(node)
  const guideKey = getDirGuideKey(node.path)
  const count = countMaterialFiles(node)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">
            {node.path ? node.name : t('materials.rootLabel')}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {node.path || '/'}
          </p>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onCreateFolder(node.path)}>
              <FolderPlus className="size-4" />
              {t('materials.menu.newFolder')}
            </Button>
            <Button variant="outline" size="sm" onClick={onPickFiles}>
              <Upload className="size-4" />
              {t('materials.action.upload')}
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(`materials.guide.${guideKey}`)}
          </p>
        </div>

        {children.length === 0 ? (
          <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <Inbox className="mb-3 size-6 text-muted-foreground" />
            <p className="text-sm text-foreground">{t('materials.emptyDir.title')}</p>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
              {t(`materials.guide.${guideKey}`)}
            </p>
            {!readOnly && (
              <Button className="mt-5" size="sm" onClick={onPickFiles}>
                <Upload className="size-4" />
                {t('materials.action.uploadHere')}
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs text-muted-foreground">
              {t('materials.overview.count', { num: count })}
            </p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {children.map((child) => {
                const isDir = child.type === ProjectFileType.Dir

                return (
                  <li key={child.path}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                      onClick={() => onSelect(child)}
                    >
                      {isDir
                        ? <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
                        : isImageFileName(child.name)
                          ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                          : <FileIcon className="size-4 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {child.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {isDir ? t('materials.list.dir') : formatFileSize(child.size ?? 0)}
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {formatDate(child.updatedAt)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
