/**
 * 设置页内容组件 - Settings Content
 * 左边分区导航、右边内容区，一屏一件事。
 *
 * 手机宽度下导航换成自动换行的胶囊，不做横向滚动条——页面不允许出现横向滚动。
 * 当前分区写进 URL hash，方便从别处直接跳到某个分区（例如 `/settings#notify`）。
 */
'use client'

import { Bell, Palette, Settings as SettingsIcon, Sparkles, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks'
import { useLoginDialogStore } from '@/store/login-dialog'
import { useUserStore } from '@/store/user'
import { cn } from '@/utils/className'
import { AppearanceSection } from './components/AppearanceSection'
import { NotifySection } from './components/NotifySection'
import { ProfileSection } from './components/ProfileSection'
import { SettingsCard, SettingsSection } from './components/SettingsSection'
import { SkillsSection } from './components/SkillsSection'

/** 分区顺序即导航顺序 */
const SECTIONS = [
  { key: 'profile', requireAuth: true },
  { key: 'appearance', requireAuth: false },
  { key: 'notify', requireAuth: true },
  { key: 'skills', requireAuth: true },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']

const SECTION_ICON: Record<SectionKey, typeof User> = {
  profile: User,
  appearance: Palette,
  notify: Bell,
  skills: Sparkles,
}

const SECTION_KEYS = SECTIONS.map(section => section.key) as SectionKey[]

/** 读 URL hash 里的分区，认不出来就返回 null */
function readHashSection(): SectionKey | null {
  if (typeof window === 'undefined')
    return null

  const hash = window.location.hash.replace('#', '')
  return (SECTION_KEYS as string[]).includes(hash) ? (hash as SectionKey) : null
}

export function SettingsPageContent() {
  const { t } = useTransClient('settings')
  const token = useUserStore(state => state.token)
  const openLoginDialog = useLoginDialogStore(state => state.openLoginDialog)
  const isLoggedIn = !!token

  useDocumentTitle(t('page.title'))

  const [activeKey, setActiveKey] = useState<SectionKey>('appearance')

  // 首屏：hash 优先，其次按登录状态给个默认分区
  useEffect(() => {
    const fromHash = readHashSection()
    if (fromHash) {
      setActiveKey(fromHash)
      return
    }
    setActiveKey(isLoggedIn ? 'profile' : 'appearance')
  }, [isLoggedIn])

  const handleSelect = useCallback((key: SectionKey) => {
    setActiveKey(key)
    if (typeof window !== 'undefined')
      window.history.replaceState(null, '', `#${key}`)
  }, [])

  const activeSection = SECTIONS.find(section => section.key === activeKey) ?? SECTIONS[1]
  const needLogin = activeSection.requireAuth && !isLoggedIn

  const renderSection = () => {
    if (needLogin) {
      return (
        <SettingsSection title={t(`nav.${activeSection.key}`)} desc={t('login.desc')}>
          <SettingsCard>
            <div className="flex flex-col items-start gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{t('login.hint')}</p>
              <Button onClick={() => openLoginDialog()}>{t('login.action')}</Button>
            </div>
          </SettingsCard>
        </SettingsSection>
      )
    }

    switch (activeSection.key) {
      case 'profile':
        return <ProfileSection />
      case 'notify':
        return <NotifySection />
      case 'skills':
        return <SkillsSection />
      case 'appearance':
      default:
        return <AppearanceSection />
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <SettingsIcon className="size-6 shrink-0 text-muted-foreground" />
          {t('page.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t('page.subtitle')}
        </p>
      </header>

      <div className="mt-7 flex flex-col gap-7 md:mt-9 md:flex-row md:gap-10">
        <nav aria-label={t('page.title')} className="md:w-56 md:shrink-0">
          <ul className="flex flex-wrap gap-2 md:sticky md:top-8 md:flex-col md:gap-1">
            {SECTIONS.map((section) => {
              const Icon = SECTION_ICON[section.key]
              const isActive = section.key === activeKey

              return (
                <li key={section.key} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => handleSelect(section.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{t(`nav.${section.key}`)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">{renderSection()}</div>
      </div>
    </div>
  )
}
