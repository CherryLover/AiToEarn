/**
 * 分步引导页 - Setup
 * 功能：把就绪检查里没通过的项一步步配好，每步说明「这是什么、不配会怎样、去哪拿」。
 */

import type { Metadata } from 'next'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/app/i18n/settings'
import { getMetadata } from '@/utils/metadata'
import { SetupPageContent } from './SetupPageContent'

// SEO 元数据
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lng: string }>
}): Promise<Metadata> {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng
  const { t } = await useTranslation(lng, 'setup')

  return getMetadata(
    {
      title: t('meta.title'),
      description: t('meta.description'),
      keywords: t('meta.keywords'),
    },
    lng,
    '/setup',
  )
}

export default function SetupPage() {
  return <SetupPageContent />
}
