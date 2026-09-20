/**
 * 配置管理页 - Config
 * 功能：查看和编辑服务端运行配置（Server / AI 两套），校验、保存、重启与恢复检查。
 */

import type { Metadata } from 'next'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/app/i18n/settings'
import { getMetadata } from '@/utils/metadata'
import { ConfigPageContent } from './ConfigPageContent'

// SEO 元数据
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lng: string }>
}): Promise<Metadata> {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng
  const { t } = await useTranslation(lng, 'configManager')

  return getMetadata(
    {
      title: t('meta.title'),
      description: t('meta.description'),
      keywords: t('meta.keywords'),
    },
    lng,
    '/config',
  )
}

export default function ConfigPage() {
  return <ConfigPageContent />
}
