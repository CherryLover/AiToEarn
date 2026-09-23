/**
 * DraftsTab - 项目详情页「生成」标签页
 * 上面选方向 + 选平台生成，下面左列草稿、右边看正文 / 配图 / 血缘。
 * 草稿全是文件：列表从 drafts/ 目录树来，正文读写走阶段 1 的文件接口。
 */
'use client'

import { FileText, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/className'
import { formatDate } from '@/utils/format'
import { useAngles } from '../AnglesTab/useAngles'
import { DraftDetail } from './DraftDetail'
import { GenerateDraftPanel } from './GenerateDraftPanel'
import { useDrafts } from './useDrafts'

interface DraftsTabProps {
  projectId: string
  /** 项目英文名，AI 任务靠它锁定工作目录 */
  projectName: string
  /** 归档项目只读 */
  readOnly: boolean
  /** 把一句话丢进右侧的项目对话里 */
  onAskAi: (prompt: string) => void
  /** 页面每跑完一轮 AI 任务就加一，收到就刷新草稿列表 */
  refreshSignal: number
  /** 拿一条草稿去发布：切到「发布」页，草稿已经选好 */
  onGoPublish: (draftPath: string) => void
}

export function DraftsTab({ projectId, projectName, readOnly, onAskAi, refreshSignal, onGoPublish }: DraftsTabProps) {
  const { t } = useTransClient('projects')

  const { drafts, isLoading, loadFailed, refresh } = useDrafts(projectId)
  const { angles, isLoading: isAnglesLoading } = useAngles(projectId)

  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // 列表变了但选中的草稿没了（被删或改名），退回到没选中
  useEffect(() => {
    if (selectedPath && !drafts.some(draft => draft.path === selectedPath))
      setSelectedPath(null)
  }, [drafts, selectedPath])

  // 右侧对话每跑完一轮，AI 可能往 drafts/ 里写了新草稿。
  // 初始值 0 不处理，否则一进页面就会白刷一次。
  useEffect(() => {
    if (refreshSignal > 0)
      void refresh()
  }, [refreshSignal, refresh])

  const selectedDraft = drafts.find(draft => draft.path === selectedPath) ?? null

  return (
    <div className="mt-4 flex flex-col gap-4">
      <GenerateDraftPanel
        projectName={projectName}
        angles={angles}
        isAnglesLoading={isAnglesLoading}
        readOnly={readOnly}
        onAskAi={onAskAi}
      />

      {isLoading && drafts.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : loadFailed ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <h3 className="text-base font-medium text-foreground">{t('drafts.list.loadFailed')}</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {t('drafts.list.loadFailedDesc')}
          </p>
          <Button className="mt-6" variant="outline" onClick={refresh}>
            <RefreshCw className="size-4" />
            {t('action.retry')}
          </Button>
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <h3 className="text-base font-medium text-foreground">{t('drafts.empty.title')}</h3>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t('drafts.empty.desc')}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          {/* 左：草稿列表 */}
          <aside className="flex max-h-[34rem] min-h-[18rem] flex-col rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('drafts.list.title', { num: drafts.length })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('action.refresh')}
                disabled={isLoading}
                onClick={refresh}
              >
                <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
              </Button>
            </div>

            <ul className="min-h-0 flex-1 overflow-auto p-2">
              {drafts.map(draft => (
                <li key={draft.path}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                      selectedPath === draft.path
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50',
                    )}
                    onClick={() => setSelectedPath(draft.path)}
                  >
                    <FileText className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{draft.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {formatDate(draft.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* 右：草稿详情 */}
          <section className="flex max-h-[34rem] min-h-[18rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="min-h-0 flex-1 overflow-auto">
              {selectedDraft ? (
                <DraftDetail
                  key={selectedDraft.path}
                  projectId={projectId}
                  draft={selectedDraft}
                  readOnly={readOnly}
                  onSaved={refresh}
                  onGoPublish={draft => onGoPublish(draft.path)}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
                  <FileText className="mb-3 size-6 text-muted-foreground" />
                  <p className="text-sm text-foreground">{t('drafts.list.pickTitle')}</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    {t('drafts.list.pickDesc')}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
