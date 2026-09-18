/**
 * 项目列表页 - Projects
 * 功能：列出当前用户的项目，支持新建、查看归档
 */

import type { Metadata } from 'next'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/app/i18n/settings'
import { getMetadata } from '@/utils/metadata'
import { ProjectsPageContent } from './ProjectsPageContent'

// SEO 元数据
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lng: string }>
}): Promise<Metadata> {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng
  const { t } = await useTranslation(lng, 'projects')

  return getMetadata(
    {
      title: t('meta.title'),
      description: t('meta.description'),
      keywords: t('meta.keywords'),
    },
    lng,
    '/projects',
  )
}

export default function ProjectsPage() {
  return <ProjectsPageContent />
}
