/**
 * 首页 - 内容管理
 * 开源版首页直接展示草稿箱内容管理核心能力。
 */

import dynamic from 'next/dynamic'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/app/i18n/languageConfig'
import { Spin } from '@/components/ui/spin'
import { getMetadata } from '@/utils/metadata'

interface PageParams {
  params: Promise<{ lng: string }>
}

export async function generateMetadata({ params }: PageParams) {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng

  const { t } = await useTranslation(lng, 'common')

  return getMetadata(
    {
      title: t('header.draftBoxSeoTitle'),
      description: t('header.draftBoxSeoDescription'),
      keywords: t('header.draftBoxSeoKeywords'),
    },
    lng,
    '/',
  )
}

/**
 * 草稿箱是纯客户端组件（`ssr: false`），服务端发过来的 HTML 里这一块是空的。
 * 不给 `loading` 的话，首屏在 JS 下完、跑完之前是**一片空白**——
 * 用户看到的就是「一直在 loading，但页面上没有任何内容」。
 * 所以先画一个骨架，让人知道东西在路上。
 */
const DraftBoxCore = dynamic(() => import('./draft-box/DraftBoxCore'), {
  ssr: false,
  loading: () => <Spin spinning className="h-full min-h-[60vh]" />,
})

export default function HomePage() {
  return <DraftBoxCore />
}
