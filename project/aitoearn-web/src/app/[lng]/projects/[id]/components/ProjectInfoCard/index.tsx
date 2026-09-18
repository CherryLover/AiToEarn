/**
 * ProjectInfoCard - 项目基本信息（只读）
 * 英文名与目录名不可修改，用等宽字体展示
 */
'use client'

import type { ProjectDetail } from '@/api/projects/project.types'
import { ProjectStatus } from '@/api/projects/project.types'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/utils/format'

interface ProjectInfoCardProps {
  project: ProjectDetail
}

function InfoRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 break-all text-sm text-foreground">{children}</div>
    </div>
  )
}

export function ProjectInfoCard({ project }: ProjectInfoCardProps) {
  const { t } = useTransClient('projects')
  const isArchived = project.status === ProjectStatus.Archived

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <h2 className="text-sm font-medium text-foreground">{t('detail.basicInfo')}</h2>

      <div className="mt-4 flex flex-col gap-3">
        <InfoRow label={t('label.name')}>
          <span className="font-mono">{project.name}</span>
        </InfoRow>

        <InfoRow label={t('label.dirName')}>
          <span className="font-mono">{project.dirName}</span>
        </InfoRow>

        <InfoRow label={t('label.status')}>
          <Badge variant={isArchived ? 'secondary' : 'default'}>
            {isArchived ? t('status.archived') : t('status.active')}
          </Badge>
        </InfoRow>

        <InfoRow label={t('label.createdAt')}>{formatDate(project.createdAt)}</InfoRow>

        <InfoRow label={t('label.updatedAt')}>{formatDate(project.updatedAt)}</InfoRow>

        {project.archivedAt && (
          <InfoRow label={t('label.archivedAt')}>{formatDate(project.archivedAt)}</InfoRow>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{t('detail.nameFixed')}</p>
    </section>
  )
}
