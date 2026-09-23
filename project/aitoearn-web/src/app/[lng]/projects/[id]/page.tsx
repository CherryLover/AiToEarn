/**
 * 项目详情页 - Project Detail
 * 标题旁显示项目状态；基本信息与项目设置是一次性配置，默认折叠，展开过的记在浏览器本地
 * 基本信息 + 可编辑显示名/说明/受众/目标 + 归档
 * 「物料」标签页做了文件浏览器，「方向」和「生成」是阶段 2 的方向演进树与草稿；
 * 「发布」是阶段 4 的手动发布卡片（内容打包给人，人自己去平台发），
 * 「数据」是插件采回来的创作平台数据（按方向汇总、每条帖子的趋势、未归属的认领）
 *
 * 右侧常驻一条 AI 对话：方向和内容都在那里聊出来，标签页上的按钮只是往那条对话里发一句话。
 */
'use client'

import type { ProjectChatPrompt } from './components/ProjectChatPanel'
import type { ProjectDetail } from '@/api/projects/project.types'
import { Archive, ArrowLeft, Sparkles } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { ProjectStatusBadge } from '../components/ProjectStatusBadge'
import { getProjectErrorKey } from '../projects.utils'
import { AnglesTab } from './components/AnglesTab'
import { DataTab } from './components/DataTab'
import { DraftsTab } from './components/DraftsTab'
import { MaterialsTab } from './components/MaterialsTab'
import { ProjectChatPanel } from './components/ProjectChatPanel'
import { ProjectInfoCard } from './components/ProjectInfoCard'
import { ProjectSettingsForm } from './components/ProjectSettingsForm'
import { PublishTab } from './components/PublishTab'

/** 标签页顺序：物料 → 方向 → 生成 → 发布 → 数据 */
const TABS = ['materials', 'angles', 'generate', 'publish', 'data'] as const

/** 基本信息 / 项目设置的展开状态，记在浏览器本地 */
const SECTION_STORAGE_KEY = {
  basicInfo: 'projects.detail.basicInfoOpen',
  settings: 'projects.detail.settingsOpen',
} as const

/** 右侧 AI 对话面板开着还是关着，也记在本地 */
const CHAT_OPEN_STORAGE_KEY = 'projects.detail.chatOpen'

type ProjectTab = (typeof TABS)[number]

/**
 * 当前标签页写进 URL hash（`#generate`）。
 *
 * 一是刷新不会被打回第一个标签页，二是「照这个方向写一条」要能把人送到「生成」页，
 * 而这得让标签页受控——顺手把地址栏也对上，链接才指得准。
 * hash 不认识就回到第一个，不能让页面空着。
 */
function readTabFromHash(): ProjectTab {
  if (typeof window === 'undefined')
    return TABS[0]

  const hash = window.location.hash.replace('#', '')
  return (TABS as readonly string[]).includes(hash) ? (hash as ProjectTab) : TABS[0]
}

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

  // 右侧 AI 对话面板。同样是挂载后才读本地，避免首屏和服务端不一致
  const [chatOpen, setChatOpen] = useState(false)
  // 标签页塞给对话的提示词（「让 AI 提炼方向」和「生成内容」都走它）
  const [chatPrompt, setChatPrompt] = useState<ProjectChatPrompt | null>(null)
  // 对话每跑完一轮加一，方向页和生成页收到就各自去登记 / 刷新
  const [aiRunSignal, setAiRunSignal] = useState(0)
  // 当前标签页。首屏用第一个和服务端保持一致，挂载后再认领 hash
  const [activeTab, setActiveTab] = useState<ProjectTab>(TABS[0])
  // 从「生成」页带到「发布」页的那条草稿
  const [publishDraft, setPublishDraft] = useState<{ path: string, at: number } | null>(null)
  // 同一毫秒内点两次也要能各发一次，用自增序号兜底
  const promptSeqRef = useRef(0)

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
    setChatOpen(readSectionOpen(CHAT_OPEN_STORAGE_KEY))
    setActiveTab(readTabFromHash())
  }, [])

  const handleTabChange = useCallback((next: string) => {
    setActiveTab(next as ProjectTab)
    // 用 replace 不留历史：标签页之间来回切不该把浏览器的后退键堆满
    if (typeof window !== 'undefined')
      window.history.replaceState(null, '', `#${next}`)
  }, [])

  /** 方向页交代完「照这个方向写一条」：切过去看结果会落在哪 */
  const handleGoToDrafts = useCallback(() => {
    handleTabChange('generate')
  }, [handleTabChange])

  /** 草稿写完了拿去发：切到发布页，并且把这条草稿带过去选上 */
  const handleGoPublish = useCallback((draftPath: string) => {
    promptSeqRef.current += 1
    setPublishDraft({ path: draftPath, at: promptSeqRef.current })
    handleTabChange('publish')
  }, [handleTabChange])

  const handleChatOpenChange = useCallback((open: boolean) => {
    setChatOpen(open)
    writeSectionOpen(CHAT_OPEN_STORAGE_KEY, open)
  }, [])

  /** 标签页想让 AI 干点什么，就把话丢进右侧对话，并把面板打开 */
  const handleAskAi = useCallback((prompt: string) => {
    promptSeqRef.current += 1
    setChatPrompt({ text: prompt, at: promptSeqRef.current })
    setChatOpen(true)
    writeSectionOpen(CHAT_OPEN_STORAGE_KEY, true)
  }, [])

  const handleChatPromptConsumed = useCallback(() => {
    setChatPrompt(null)
  }, [])

  /**
   * 对话跑完一轮，AI 可能往项目目录里写了方向文件或草稿。
   * 这里只发个信号，具体去登记还是刷新由各标签页自己决定。
   */
  const handleChatTaskFinished = useCallback(() => {
    setAiRunSignal(signal => signal + 1)
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
    // 宽屏时右侧对话面板是正常的一列，把内容挤窄而不是盖住它，
    // 所以这里是左右两栏、左栏自己滚，面板才能定住不跟着内容走
    <div className="flex h-full w-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className={cn(
          'mx-auto w-full px-4 py-6 md:px-8 md:py-8',
          // 面板占掉右边之后，内容区再按 6xl 居中就会偏，放宽让它自己填满
          chatOpen ? 'max-w-5xl' : 'max-w-6xl',
        )}
        >
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
            <Tabs value={activeTab} onValueChange={handleTabChange}>
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
                        onAskAi={handleAskAi}
                        onGoToDrafts={handleGoToDrafts}
                        refreshSignal={aiRunSignal}
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
                        onAskAi={handleAskAi}
                        refreshSignal={aiRunSignal}
                        onGoPublish={handleGoPublish}
                      />
                    )}
              </TabsContent>

              <TabsContent value="publish">
                {/* 归档项目的草稿文件和发布接口在服务端一律拒绝，直接说清楚为什么打不开 */}
                {isArchived
                  ? (
                      <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                        {t('publish.archived')}
                      </div>
                    )
                  : (
                      <PublishTab
                        projectId={project.id}
                        readOnly={false}
                        presetDraft={publishDraft}
                      />
                    )}
              </TabsContent>

              <TabsContent value="data">
                {/* 归档项目不给派采集工单：那台机器采回来的数据也归不到已经归档的项目上。
                列表仍旧能看，归档不等于数据作废 */}
                <DataTab projectId={project.id} readOnly={isArchived} />
              </TabsContent>
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
      </div>

      {/* 归档项目只读，AI 也没什么可干的，不给对话入口 */}
      {!isArchived && !chatOpen && (
        <Button
          className="fixed bottom-24 right-4 z-30 shadow-lg md:bottom-8"
          size="sm"
          onClick={() => handleChatOpenChange(true)}
        >
          <Sparkles className="size-4" />
          {t('chat.open')}
        </Button>
      )}

      {!isArchived && (
        <ProjectChatPanel
          projectName={project.name}
          open={chatOpen}
          onOpenChange={handleChatOpenChange}
          pendingPrompt={chatPrompt}
          onPromptConsumed={handleChatPromptConsumed}
          onTaskFinished={handleChatTaskFinished}
        />
      )}
    </div>
  )
}
