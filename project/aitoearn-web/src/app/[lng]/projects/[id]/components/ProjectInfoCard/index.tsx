/**
 * ProjectInfoCard - 项目基本信息（只读）
 * 英文名与目录名不可修改，用等宽字体展示
 * 只有建项目时才需要看一眼，默认折叠，展开状态由详情页统一控制
 */
'use client'

import type { ProjectDetail } from '@/api/projects/project.types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTransClient } from '@/app/i18n/client'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatDate } from '@/utils/format'
import { ProjectStatusBadge } from '../../../components/ProjectStatusBadge'

interface ProjectInfoCardProps {
  project: ProjectDetail
  /** 是否展开，由详情页记忆 */
  open: boolean
  onOpenChange: (open: boolean) => void
}

function InfoRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 break-all text-sm text-foreground">{children}</div>
    </div>
  )
}

export function ProjectInfoCard({ project, open, onOpenChange }: ProjectInfoCardProps) {
  const { t } = useTransClient('projects')

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl border border-border bg-card"
    >
      <CollapsibleTrigger
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/40 md:px-5"
        data-testid="project-basic-info-toggle"
      >
        {open
          ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <h2 className="text-sm font-medium text-foreground">{t('detail.basicInfo')}</h2>
      </CollapsibleTrigger>

      <CollapsibleContent className="px-4 pb-4 md:px-5 md:pb-5">
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <InfoRow label={t('label.name')}>
            <span className="font-mono">{project.name}</span>
          </InfoRow>

          <InfoRow label={t('label.dirName')}>
            <span className="font-mono">{project.dirName}</span>
          </InfoRow>

          <InfoRow label={t('label.status')}>
            <ProjectStatusBadge status={project.status} />
          </InfoRow>

          <InfoRow label={t('label.createdAt')}>{formatDate(project.createdAt)}</InfoRow>

          <InfoRow label={t('label.updatedAt')}>{formatDate(project.updatedAt)}</InfoRow>

          {project.archivedAt && (
            <InfoRow label={t('label.archivedAt')}>{formatDate(project.archivedAt)}</InfoRow>
          )}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">{t('detail.nameFixed')}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}
