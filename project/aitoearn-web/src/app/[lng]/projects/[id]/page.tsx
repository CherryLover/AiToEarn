/**
 * 项目详情页 - Project Detail
 * 标题旁显示项目状态；基本信息与项目设置是一次性配置，默认折叠，展开过的记在浏览器本地
 * 基本信息 + 可编辑显示名/说明/受众/目标 + 归档
 * 「物料」标签页做了文件浏览器，「方向」和「生成」是阶段 2 的方向演进树与草稿；
 * 发布、数据两个标签页先留占位
 */
'use client'

import type { ProjectDetail } from '@/api/projects/project.types'
import { Archive, ArrowLeft } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { archiveProjectApi, getProjectDetailApi } from '@/api/projects/project.api'
import { ProjectStatus } from '@/api/projects/project.types'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDocumentTitle } from '@/hooks'
import { toast } from '@/utils/ui/toast'
import { ProjectStatusBadge } from '../components/ProjectStatusBadge'
import { getProjectErrorKey } from '../projects.utils'
import { AnglesTab } from './components/AnglesTab'
import { DraftsTab } from './components/DraftsTab'
import { MaterialsTab } from './components/MaterialsTab'
import { ProjectInfoCard } from './components/ProjectInfoCard'
import { ProjectSettingsForm } from './components/ProjectSettingsForm'

/** 标签页顺序：物料 → 方向 → 生成，发布和数据留给后面的阶段 */
const TABS = ['materials', 'angles', 'generate', 'publish', 'data'] as const

/** 还没实现的标签页 */
const PLACEHOLDER_TABS = ['publish', 'data'] as const

/** 基本信息 / 项目设置的展开状态，记在浏览器本地 */
const SECTION_STORAGE_KEY = {
  basicInfo: 'projects.detail.basicInfoOpen',
  settings: 'projects.detail.settingsOpen',
} as const

type SectionKey = keyof typeof SECTION_STORAGE_KEY

/** 读不到（隐私模式、被禁用）就按默认折叠处理，不能让页面崩 */
function readSectionOpen(key: string): boolean {
  if (typeof window === 'undefined')
    return false

  try {
    return window.localStorage.getItem(key) === '1'
  }
  catch {
    return false
  }
}

/** 写不进去也只是下次进来仍然折叠，不提示、不打断 */
function writeSectionOpen(key: string, open: boolean) {
  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.setItem(key, open ? '1' : '0')
  }
  catch {
    // 忽略：无痕模式下写入会抛异常
  }
}

export default function ProjectDetailPage() {
  const { t } = useTransClient('projects')
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const lng = params.lng as string

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isArchiving, setIsArchiving] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  // 默认折叠，首屏渲染与服务端一致，挂载后再补上本地记住的展开状态
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    basicInfo: false,
    settings: false,
  })

  useDocumentTitle(project?.displayName, t('page.title'))

  const loadDetail = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await getProjectDetailApi(id)
      if (res && res.code === 0 && res.data) {
        setProject(res.data)
      }
      else {
        setProject(null)
        if (res && res.code !== 0)
          toast.error(t(getProjectErrorKey(res.code)))
        else
          toast.error(t('detail.loadFailed'))
      }
    }
    catch (error) {
      console.error('Load project detail failed:', error)
      setProject(null)
      toast.error(t('detail.loadFailed'))
    }
    finally {
      setIsLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    if (id)
      loadDetail()
  }, [id, loadDetail])

  useEffect(() => {
    setOpenSections({
      basicInfo: readSectionOpen(SECTION_STORAGE_KEY.basicInfo),
      settings: readSectionOpen(SECTION_STORAGE_KEY.settings),
    })
  }, [])

  const handleSectionOpenChange = (section: SectionKey, open: boolean) => {
    setOpenSections(prev => ({ ...prev, [section]: open }))
    writeSectionOpen(SECTION_STORAGE_KEY[section], open)
  }

  const handleBack = () => {
    router.push(`/${lng}/projects`)
  }

  const handleArchive = async () => {
    if (!project)
      return

    setIsArchiving(true)
    try {
      const res = await archiveProjectApi(project.id)
      if (res && res.code === 0 && res.data) {
        setProject(res.data)
        setArchiveConfirmOpen(false)
        toast.success(t('detail.archiveSuccess'))
        return
      }

      toast.error(t(getProjectErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Archive project failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsArchiving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-48 w-full rounded-xl" />
        <Skeleton className="mt-4 h-72 w-full rounded-xl" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-20 text-center md:px-8">
        <h1 className="text-base font-medium text-foreground">{t('detail.notFound')}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('detail.notFoundDesc')}</p>
        <Button className="mt-6" variant="outline" onClick={handleBack}>
          <ArrowLeft className="size-4" />
          {t('action.backToList')}
        </Button>
      </div>
    )
  }

  const isArchived = project.status === ProjectStatus.Archived

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      {/* 页头 */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={handleBack}>
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-foreground">
                {project.displayName}
              </h1>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{project.name}</p>
          </div>
        </div>

        {!isArchived && (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => setArchiveConfirmOpen(true)}
          >
            <Archive className="size-4" />
            {t('detail.archive')}
          </Button>
        )}
      </header>

      {isArchived && (
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('detail.archivedTip')}
        </p>
      )}

      {/* 基本信息：一次性配置，默认折叠 */}
      <div className="mt-6">
        <ProjectInfoCard
          project={project}
          open={openSections.basicInfo}
          onOpenChange={open => handleSectionOpenChange('basicInfo', open)}
        />
      </div>

      {/* 可编辑字段：一次性配置，默认折叠 */}
      <div className="mt-3">
        <ProjectSettingsForm
          project={project}
          onSaved={setProject}
          disabled={isArchived}
          open={openSections.settings}
          onOpenChange={open => handleSectionOpenChange('settings', open)}
        />
      </div>

      {/* 物料 / 方向 / 生成 / 发布 / 数据 */}
      <div className="mt-6">
        <Tabs defaultValue={TABS[0]}>
          <TabsList>
            {TABS.map(tab => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="materials">
            {/* 归档项目的文件接口在服务端一律拒绝（连只读的 tree / read / download 也一样），
                渲染出来只会是一个永远加载失败的目录树，所以直接说清楚为什么打不开 */}
            {isArchived
              ? (
                  <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                    {t('materials.archived')}
                  </div>
                )
              : <MaterialsTab projectId={project.id} readOnly={false} />}
          </TabsContent>

          <TabsContent value="angles">
            {/* 方向接口和物料接口一样，归档项目在服务端一律拒绝，直接说清楚为什么打不开 */}
            {isArchived
              ? (
                  <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                    {t('angles.archived')}
                  </div>
                )
              : (
                  <AnglesTab
                    projectId={project.id}
                    projectName={project.name}
                    readOnly={false}
                  />
                )}
          </TabsContent>

          <TabsContent value="generate">
            {isArchived
              ? (
                  <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                    {t('drafts.archived')}
                  </div>
                )
              : (
                  <DraftsTab
                    projectId={project.id}
                    projectName={project.name}
                    readOnly={false}
                  />
                )}
          </TabsContent>

          {PLACEHOLDER_TABS.map(tab => (
            <TabsContent key={tab} value={tab}>
              <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                {t('tabs.placeholder')}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* 归档二次确认 */}
      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.archiveConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.archiveConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>
              {t('detail.archiveConfirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isArchiving}
              onClick={(event) => {
                // 交给异步流程控制关闭时机，避免请求没回来就把弹窗关了
                event.preventDefault()
                handleArchive()
              }}
            >
              {isArchiving ? t('detail.archiving') : t('detail.archiveConfirmOk')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
