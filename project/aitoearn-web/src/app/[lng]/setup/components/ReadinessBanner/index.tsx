/**
 * 就绪检查横幅
 *
 * 挂在已登录布局的主内容区顶部（`MainContent` 的 `banner` 位）。干两件事：
 * 进站拉一次就绪检查，以及在有必需项没通过时说清楚**坏的是哪个功能**。
 *
 * 四条规矩，改之前先读：
 *
 * 1. **说人话。** 横幅上那句是「AI 提炼方向现在用不了：上游 AI 还没配」，
 *    不是「配置缺失」。用户不知道什么叫配置缺失，他知道的是自己点的那个按钮没反应
 *    ——这个功能坏了半年没人报，就是因为页面上只写了一句 Internal server error。
 * 2. **未登录不拉。** 接口要登录，未登录调只会拿到 401。退出登录时清掉结果，
 *    免得把上一个账号的状态带给下一个。
 * 3. **不知道就不说。** 拉不到结果（接口还没上线、服务没起来）时横幅不显示。
 *    宁可少提醒一次，也不要把每个人都拦在一条自己都不确定的警告后面。
 * 4. **关掉只在本次会话有效。** 配置没修好，刷新页面就该再提醒一次。
 *    所以「先不管」存在内存 store 里，不进 localStorage。
 */

'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { useReadinessStore } from '@/store/readiness'
import { useUserStore } from '@/store/user'
import {
  countBlockingItems,
  isKnownItemKey,
  pickPrimaryBlockingItem,
} from '../../setup.utils'

/** 这些页面上不显示横幅：引导页本身和配置管理页，人已经在修了，不用再催一遍 */
const SILENT_PATH_SEGMENTS = ['/setup', '/config']

export function ReadinessBanner() {
  const { t } = useTransClient('setup')
  const pathname = usePathname()

  const token = useUserStore(state => state.token)
  const data = useReadinessStore(state => state.data)
  const bannerDismissed = useReadinessStore(state => state.bannerDismissed)
  const fetchedOnce = useReadinessStore(state => state.fetchedOnce)
  const ensureLoaded = useReadinessStore(state => state.ensureLoaded)
  const dismissBanner = useReadinessStore(state => state.dismissBanner)
  const reset = useReadinessStore(state => state.reset)

  useEffect(() => {
    if (!token) {
      // 退出登录（或还没登录）：把上一次的结果清掉，换账号进来重新拉
      if (fetchedOnce)
        reset()
      return
    }
    // 同一次会话只会真的发一次请求，`ensureLoaded` 自己挡住重复
    void ensureLoaded()
  }, [token, fetchedOnce, ensureLoaded, reset])

  if (!token || bannerDismissed || !data)
    return null

  if (SILENT_PATH_SEGMENTS.some(segment => pathname?.includes(segment)))
    return null

  const primary = pickPrimaryBlockingItem(data.items)
  if (!primary)
    return null

  const headline = isKnownItemKey(primary.key)
    ? t(`item.${primary.key}.broken`)
    : t('item.unknown.broken', { key: primary.key })

  const restCount = countBlockingItems(data.items) - 1

  return (
    <div className="w-full border-b border-warning/30 bg-warning/10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex min-w-0 items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" />
          <p className="min-w-0 text-sm leading-relaxed text-foreground">
            {headline}
            {restCount > 0 && (
              <span className="text-warning-text">
                {' '}
                {t('banner.more', { count: restCount })}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" asChild>
            <Link href="/setup">{t('banner.action')}</Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={dismissBanner}>
            {t('banner.dismiss')}
          </Button>
        </div>
      </div>
    </div>
  )
}
