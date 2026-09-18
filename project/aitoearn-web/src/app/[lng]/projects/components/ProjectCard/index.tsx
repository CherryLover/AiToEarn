/**
 * ProjectCard - 项目列表卡片
 * 显示名为主、英文名为次（等宽字体），标题旁显示状态，点击进入项目详情
 */
'use client'

import type { ProjectListItem } from '@/api/projects/project.types'
import Link from 'next/link'
import { useTransClient } from '@/app/i18n/client'
import { useGetClientLng } from '@/hooks/useSystem'
import { formatDate } from '@/utils/format'
import { ProjectStatusBadge } from '../ProjectStatusBadge'

interface ProjectCardProps {
  project: ProjectListItem
}

export function ProjectCard({ project }: ProjectCardProps) {
  const { t } = useTransClient('projects')
  const lng = useGetClientLng()

  return (
    <Link
      href={`/${lng}/projects/${project.id}`}
      className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-cyan/40 hover:bg-accent/40"
      data-testid={`project-card-${project.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-base font-medium text-foreground">
          {project.displayName}
        </h3>
        <ProjectStatusBadge status={project.status} />
      </div>

      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{project.name}</p>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
        {project.desc || t('list.noDesc')}
      </p>

      <p className="mt-3 text-xs text-muted-foreground">
        {t('list.createdAt', { time: formatDate(project.createdAt) })}
      </p>
    </Link>
  )
}
