/**
 * 项目列表页内容组件 - Projects Content
 * 客户端组件，负责列表拉取、归档切换与新建项目对话框
 */
'use client'

import type { ProjectListItem } from '@/api/projects/project.types'
import { Archive, FolderKanban, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getProjectListApi } from '@/api/projects/project.api'
import { ProjectStatus } from '@/api/projects/project.types'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDocumentTitle } from '@/hooks'
import { toast } from '@/utils/ui/toast'
import { CreateProjectDialog } from './components/CreateProjectDialog'
import { ProjectCard } from './components/ProjectCard'

/** 骨架屏占位数量 */
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6']

export function ProjectsPageContent() {
  const { t } = useTransClient('projects')

  useDocumentTitle(t('page.title'))

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  /** 拉取列表，按当前视图筛选状态 */
  const loadProjects = useCallback(
    async (archived: boolean) => {
      setIsLoading(true)
      try {
        const res = await getProjectListApi(
          archived ? ProjectStatus.Archived : ProjectStatus.Active,
        )
        if (res && res.code === 0) {
          setProjects(res.data || [])
        }
        else {
          setProjects([])
          toast.error(t('list.loadFailed'))
        }
      }
      catch (error) {
        console.error('Load project list failed:', error)
        setProjects([])
        toast.error(t('list.loadFailed'))
      }
      finally {
        setIsLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    loadProjects(showArchived)
  }, [showArchived, loadProjects])

  /** 切换进行中 / 归档视图 */
  const handleToggleArchived = () => {
    setShowArchived(prev => !prev)
  }

  /** 创建成功后回到进行中视图并刷新 */
  const handleCreated = () => {
    setCreateOpen(false)
    if (showArchived) {
      setShowArchived(false)
      return
    }
    loadProjects(false)
  }

  const isEmpty = !isLoading && projects.length === 0

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      {/* 页头 */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('page.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleToggleArchived}>
            <Archive className="size-4" />
            {showArchived ? t('action.viewActive') : t('action.viewArchived')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadProjects(showArchived)}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
            {t('action.refresh')}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('action.create')}
          </Button>
        </div>
      </header>

      {/* 列表主体 */}
      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SKELETON_KEYS.map(key => (
              <Skeleton key={key} className="h-[132px] w-full rounded-xl" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FolderKanban className="size-6" />
            </div>
            <h2 className="text-base font-medium text-foreground">
              {showArchived ? t('emptyArchived.title') : t('empty.title')}
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {showArchived ? t('emptyArchived.desc') : t('empty.desc')}
            </p>
            {!showArchived && (
              <Button className="mt-6" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t('empty.action')}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {/* 新建项目对话框 */}
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  )
}
