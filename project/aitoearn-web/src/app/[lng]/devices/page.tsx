/**
 * 设备页 - Devices
 * 功能：管理执行端设备（浏览器插件）与执行工单
 */

import type { Metadata } from 'next'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/app/i18n/settings'
import { getMetadata } from '@/utils/metadata'
import { DevicesPageContent } from './DevicesPageContent'

// SEO 元数据
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lng: string }>
}): Promise<Metadata> {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng
  const { t } = await useTranslation(lng, 'devices')

  return getMetadata(
    {
      title: t('meta.title'),
      description: t('meta.description'),
      keywords: t('meta.keywords'),
    },
    lng,
    '/devices',
  )
}

export default function DevicesPage() {
  return <DevicesPageContent />
}
