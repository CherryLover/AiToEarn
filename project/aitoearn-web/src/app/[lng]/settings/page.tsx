/**
 * 设置页 - Settings
 * 功能：个人资料、外观、通知（Bark 推送配置与通知规则）
 */

import type { Metadata } from 'next'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/app/i18n/settings'
import { getMetadata } from '@/utils/metadata'
import { SettingsPageContent } from './SettingsPageContent'

// SEO 元数据
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lng: string }>
}): Promise<Metadata> {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng
  const { t } = await useTranslation(lng, 'settings')

  return getMetadata(
    {
      title: t('meta.title'),
      description: t('meta.description'),
      keywords: t('meta.keywords'),
    },
    lng,
    '/settings',
  )
}

export default function SettingsPage() {
  return <SettingsPageContent />
}
