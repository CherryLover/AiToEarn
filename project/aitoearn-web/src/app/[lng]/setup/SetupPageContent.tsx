/**
 * 分步引导页内容组件
 *
 * 一项检查 = 一步，顺序照契约 4.1 的表：四个必需项在前，非必需的排在后面。
 * 页面外壳、留白、卡片全部复用设置页那一套（`SettingsSection` / `SettingsCard`），
 * 不另起一套排版。
 *
 * 三条交互约定：
 *
 * 1. **已经通过的步骤默认折叠。** 进来第一眼该看到的是「还差哪一步」，
 *    不是一屏已经绿了的东西。
 * 2. **复检是全局的。** 每一步点「重新检查」都拉同一个 `/system/readiness`，
 *    结果写回同一个 store——一项配好了顺带把别项的状态也刷新，比一项一项探更准。
 * 3. **跳过只在本页有效。** 跳过的是「这次不配」，不是「这项不需要」。
 *    刷新页面它会回来，因为它确实还没配。
 */

'use client'

import { CheckCircle2, ListChecks, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReadinessStatus } from '@/api/system/readiness.types'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDocumentTitle } from '@/hooks'
import { useLoginDialogStore } from '@/store/login-dialog'
import { useReadinessStore } from '@/store/readiness'
import { useUserStore } from '@/store/user'
import { SettingsCard, SettingsSection } from '../settings/components/SettingsSection'
import { SetupStep } from './components/SetupStep'
import { countBlockingItems, resolveStepSpec, sortReadinessItems } from './setup.utils'

export function SetupPageContent() {
  const { t } = useTransClient('setup')

  const token = useUserStore(state => state.token)
  const openLoginDialog = useLoginDialogStore(state => state.openLoginDialog)

  const data = useReadinessStore(state => state.data)
  const loadState = useReadinessStore(state => state.loadState)
  const ensureLoaded = useReadinessStore(state => state.ensureLoaded)
  const refresh = useReadinessStore(state => state.refresh)

  /** 展开的步骤，可以同时开多个。null 表示还没按结果决定过 */
  const [openKeys, setOpenKeys] = useState<string[] | null>(null)
  /** 本页跳过的非必需项，不落盘 */
  const [skippedKeys, setSkippedKeys] = useState<string[]>([])

  useDocumentTitle(t('page.title'))

  useEffect(() => {
    if (token)
      void ensureLoaded()
  }, [token, ensureLoaded])

  const items = useMemo(() => (data ? sortReadinessItems(data.items) : []), [data])

  // 进来时只展开第一个没通过的：已经绿了的收起来，别让人从一屏已完成里找事做
  useEffect(() => {
    if (openKeys !== null || items.length === 0)
      return

    const firstPending = items.find(item => item.status !== ReadinessStatus.Ok)
    setOpenKeys(firstPending ? [firstPending.key] : [])
  }, [items, openKeys])

  const handleToggle = useCallback((key: string) => {
    setOpenKeys((previous) => {
      const current = previous ?? []
      return current.includes(key)
        ? current.filter(item => item !== key)
        : [...current, key]
    })
  }, [])

  const handleSkip = useCallback((key: string) => {
    setSkippedKeys(previous =>
      previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key],
    )
  }, [])

  // 每一步点「重新检查」都走这里：拉同一个 /system/readiness，结果写回同一个 store。
  // 回给调用方是为了让那一步能当场说出自己过了没有，不用再等父组件重渲染
  const handleRecheck = useCallback(() => refresh(), [refresh])

  if (!token) {
    return (
      <PageFrame title={t('page.title')} subtitle={t('page.subtitle')}>
        <SettingsSection title={t('login.title')} desc={t('login.hint')}>
          <SettingsCard>
            <Button onClick={() => openLoginDialog()}>{t('login.action')}</Button>
          </SettingsCard>
        </SettingsSection>
      </PageFrame>
    )
  }

  if (!data && loadState === 'loading') {
    return (
      <PageFrame title={t('page.title')} subtitle={t('page.subtitle')}>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </PageFrame>
    )
  }

  if (!data) {
    return (
      <PageFrame title={t('page.title')} subtitle={t('page.subtitle')}>
        <SettingsSection title={t('load.failedTitle')} desc={t('load.failedDesc')}>
          <SettingsCard>
            <Button variant="outline" onClick={handleRecheck}>
              <RefreshCw className="size-4" />
              {t('load.retry')}
            </Button>
          </SettingsCard>
        </SettingsSection>
      </PageFrame>
    )
  }

  const blockingCount = countBlockingItems(items)
  const optionalPending = items.filter(
    item => !item.required && item.status !== ReadinessStatus.Ok,
  ).length

  return (
    <PageFrame title={t('page.title')} subtitle={t('page.subtitle')}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span
            className={
              blockingCount > 0 ? 'font-medium text-warning-text' : 'font-medium text-success-text'
            }
          >
            {blockingCount > 0 ? t('summary.blocking', { count: blockingCount }) : t('summary.allDone')}
          </span>
          {optionalPending > 0 && (
            <span className="text-muted-foreground">
              {t('summary.optionalLeft', { count: optionalPending })}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {items.map((item, index) => (
            <SetupStep
              key={item.key}
              item={item}
              spec={resolveStepSpec(item)}
              index={index + 1}
              open={(openKeys ?? []).includes(item.key)}
              onToggle={() => handleToggle(item.key)}
              skipped={skippedKeys.includes(item.key)}
              onSkip={() => handleSkip(item.key)}
              onRecheck={handleRecheck}
            />
          ))}
        </div>

        {/* 全部通过：一句收尾 + 回首页（契约 4.2） */}
        {blockingCount === 0 && (
          <SettingsCard className="border-success/40">
            <div className="flex flex-col items-start gap-4">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-text" />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground">{t('done.title')}</h3>
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {t('done.desc')}
                  </p>
                </div>
              </div>
              <Button asChild>
                <Link href="/">{t('actions.backHome')}</Link>
              </Button>
            </div>
          </SettingsCard>
        )}
      </div>
    </PageFrame>
  )
}

interface PageFrameProps {
  title: string
  subtitle: string
  children: React.ReactNode
}

/** 页面外壳：留白和最大宽度跟设置页一模一样，手机宽度下不横向滚动 */
function PageFrame({ title, subtitle, children }: PageFrameProps) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <ListChecks className="size-6 shrink-0 text-muted-foreground" />
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
      </header>

      <div className="mt-7 md:mt-9">{children}</div>
    </div>
  )
}
