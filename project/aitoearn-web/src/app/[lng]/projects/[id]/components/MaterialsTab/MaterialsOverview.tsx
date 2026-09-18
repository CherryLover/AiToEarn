/**
 * MaterialsOverview - 没选中文件时的物料概览
 * 按标准目录列出各放了多少份材料，并直接说清楚每个目录该放什么
 */
'use client'

import type { FileNode } from '@/api/projects/project-file.types'
import { FolderClosed, Upload } from 'lucide-react'
import { PROJECT_MATERIAL_DIRS } from '@/api/projects/project-file.constants'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/className'
import { countMaterialFiles, findNodeByPath } from './materials.utils'

interface MaterialsOverviewProps {
  tree: FileNode | null
  readOnly: boolean
  onOpenDir: (path: string) => void
  onPickFiles: () => void
}

export function MaterialsOverview({ tree, readOnly, onOpenDir, onPickFiles }: MaterialsOverviewProps) {
  const { t } = useTransClient('projects')

  const total = countMaterialFiles(tree)

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{t('materials.overview.title')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {total > 0
              ? t('materials.overview.subtitle', { total })
              : t('materials.overview.emptySubtitle')}
          </p>
        </div>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={onPickFiles}>
            <Upload className="size-4" />
            {t('materials.action.upload')}
          </Button>
        )}
      </div>

      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {PROJECT_MATERIAL_DIRS.map((dir) => {
          const node = findNodeByPath(tree, dir.path)
          const count = countMaterialFiles(node)

          return (
            <li key={dir.path}>
              <button
                type="button"
                className="flex h-full w-full flex-col rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-brand-cyan/40 hover:bg-accent/40"
                onClick={() => onOpenDir(dir.path)}
              >
                <span className="flex items-center gap-2">
                  <FolderClosed className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {dir.path}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs',
                      count > 0 ? 'bg-accent text-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {t('materials.overview.count', { num: count })}
                  </span>
                </span>
                <span className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t(`materials.guide.${dir.guideKey}`)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {t('materials.overview.tip')}
      </p>
    </div>
  )
}
