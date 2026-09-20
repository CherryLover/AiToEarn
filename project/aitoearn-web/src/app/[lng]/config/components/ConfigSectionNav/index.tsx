/**
 * ConfigSectionNav - 配置分区导航
 *
 * 照设置页（`app/[lng]/settings/SettingsPageContent.tsx`）那套来：
 * 桌面端左侧竖排，手机宽度下换成自动换行的胶囊——**不做横向滚动条**。
 * 点一下切一个分区，右边只渲染当前分区，不再像弹窗里那样整页滚动 + 滚动监听高亮。
 */
'use client'

import type { ConfigSectionView } from '../../types'
import { useTransClient } from '@/app/i18n/client'
import { cn } from '@/utils/className'

interface ConfigSectionNavProps {
  sections: ConfigSectionView[]
  activeSectionId: string
  disabled?: boolean
  onSectionSelect: (sectionId: string) => void
}

export function ConfigSectionNav({ sections, activeSectionId, disabled, onSectionSelect }: ConfigSectionNavProps) {
  const { t } = useTransClient('configManager')

  return (
    <nav aria-label={t('page.title')} className="md:w-60 md:shrink-0">
      <ul className="flex flex-wrap gap-2 md:sticky md:top-8 md:flex-col md:gap-1">
        {sections.map((section) => {
          const isActive = section.id === activeSectionId

          return (
            <li key={section.id} className="min-w-0">
              <button
                type="button"
                disabled={disabled}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSectionSelect(section.id)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {section.notRecommended && (
                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-normal text-warning-text ring-1 ring-warning/30">
                      {t('status.notRecommended')}
                    </span>
                  )}
                  {section.modifiedFieldCount > 0 && (
                    <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-normal text-warning-text ring-1 ring-warning/30">
                      {section.modifiedFieldCount}
                    </span>
                  )}
                  <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground ring-1 ring-border">
                    {section.fieldCount}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
