/**
 * FileTree - 物料目录树
 * 可展开收起，行内菜单（也支持右键）做新建文件夹、改名、删除
 */
'use client'

import type { FileNode } from '@/api/projects/project-file.types'
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileText,
  FolderClosed,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import { ProjectFileType } from '@/api/projects/project-file.types'
import { useTransClient } from '@/app/i18n/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/utils/className'
import { getVisibleChildren, isImageFileName, isTextFileName } from './materials.utils'

interface FileTreeProps {
  root: FileNode
  selectedPath: string | null
  loadingPaths: string[]
  readOnly: boolean
  isExpanded: (path: string) => boolean
  onSelect: (node: FileNode) => void
  onToggle: (node: FileNode) => void
  onCreateFolder: (parentPath: string) => void
  onRename: (node: FileNode) => void
  onDelete: (node: FileNode) => void
}

type FileTreeNodeProps = Omit<FileTreeProps, 'root'> & {
  node: FileNode
  depth: number
  /** 根节点不给改名和删除入口 */
  isRoot: boolean
}

function NodeIcon({ node, expanded }: { node: FileNode, expanded: boolean }) {
  if (node.type === ProjectFileType.Dir) {
    return expanded
      ? <FolderOpen className="size-4 shrink-0 text-brand-cyan" />
      : <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
  }

  if (isImageFileName(node.name))
    return <ImageIcon className="size-4 shrink-0 text-muted-foreground" />

  if (isTextFileName(node.name))
    return <FileText className="size-4 shrink-0 text-muted-foreground" />

  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />
}

function FileTreeNode(props: FileTreeNodeProps) {
  const {
    node,
    depth,
    isRoot,
    selectedPath,
    loadingPaths,
    readOnly,
    isExpanded,
    onSelect,
    onToggle,
    onCreateFolder,
    onRename,
    onDelete,
  } = props
  const { t } = useTransClient('projects')
  const [menuOpen, setMenuOpen] = useState(false)

  const isDir = node.type === ProjectFileType.Dir
  const expanded = isDir && isExpanded(node.path)
  const isSelected = selectedPath === node.path
  const isLoading = loadingPaths.includes(node.path)
  const children = expanded ? getVisibleChildren(node) : []

  const handleRowClick = () => {
    onSelect(node)
    if (isDir)
      onToggle(node)
  }

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md py-1 pr-1 text-sm transition-colors',
          isSelected ? 'bg-accent text-foreground' : 'hover:bg-accent/50 text-muted-foreground',
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onContextMenu={(event) => {
          if (readOnly)
            return
          event.preventDefault()
          onSelect(node)
          setMenuOpen(true)
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={handleRowClick}
          data-testid={`material-node-${node.path || 'root'}`}
        >
          {isDir ? (
            <span className="flex size-4 shrink-0 items-center justify-center">
              {isLoading
                ? <Loader2 className="size-3.5 animate-spin" />
                : expanded
                  ? <ChevronDown className="size-3.5" />
                  : <ChevronRight className="size-3.5" />}
            </span>
          ) : (
            <span className="size-4 shrink-0" />
          )}
          <NodeIcon node={node} expanded={expanded} />
          <span className={cn('truncate', isSelected && 'font-medium')}>
            {isRoot ? t('materials.rootLabel') : node.name}
          </span>
        </button>

        {!readOnly && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('materials.menu.more')}
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100',
                  menuOpen && 'opacity-100',
                )}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {isDir && (
                <DropdownMenuItem onSelect={() => onCreateFolder(node.path)}>
                  {t('materials.menu.newFolder')}
                </DropdownMenuItem>
              )}
              {!isRoot && (
                <>
                  {isDir && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={() => onRename(node)}>
                    {t('materials.menu.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onDelete(node)}
                  >
                    {t('materials.menu.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && (
        <ul>
          {children.length === 0 ? (
            <li
              className="py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              {isLoading ? t('materials.tree.loading') : t('materials.tree.emptyDir')}
            </li>
          ) : (
            children.map(child => (
              <FileTreeNode
                key={child.path}
                {...props}
                node={child}
                depth={depth + 1}
                isRoot={false}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}

export function FileTree({ root, ...rest }: FileTreeProps) {
  return (
    <ul className="select-none">
      <FileTreeNode {...rest} node={root} depth={0} isRoot />
    </ul>
  )
}
