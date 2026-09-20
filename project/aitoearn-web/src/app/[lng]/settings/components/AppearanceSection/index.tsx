/**
 * 外观分区 - 主题与语言
 * 从原来的设置弹窗 GeneralTab 搬过来重新排版：一行一件事，标签和说明分开，留白拉开。
 *
 * 主题和语言是「选了立刻生效」的偏好，不走保存按钮——它们不提交到服务端，
 * 主题存在浏览器本地（next-themes），语言是换路由，多一步确认反而别扭。
 * 需要显式保存的是通知那种会发请求出去的配置。
 */

'use client'

import { setCookie } from 'cookies-next'
import { Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { getAllLanguageOptions } from '@/app/i18n/languageConfig'
import { cookieName } from '@/app/i18n/settings'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useGetClientLng } from '@/hooks/useSystem'
import { cn } from '@/utils/className'
import darkColorImg from '../../images/darkColor.png'
import followSystemImg from '../../images/followSystem.png'
import lightColorImg from '../../images/lightColor.png'
import { SettingsCard, SettingsSection } from '../SettingsSection'

const languageOptions = getAllLanguageOptions()

/** 主题选项配置 */
const themeOptions: { value: string, labelKey: string, image: typeof lightColorImg }[] = [
  { value: 'light', labelKey: 'general.themeLight', image: lightColorImg },
  { value: 'dark', labelKey: 'general.themeDark', image: darkColorImg },
  { value: 'system', labelKey: 'general.themeSystem', image: followSystemImg },
]

export function AppearanceSection() {
  const { t } = useTransClient('settings')
  const router = useRouter()
  const lng = useGetClientLng()
  const [isChangingLanguage, setIsChangingLanguage] = useState(false)
  const { theme, setTheme } = useTheme()

  const handleLanguageChange = async (newLng: string) => {
    if (isChangingLanguage || newLng === lng)
      return

    setIsChangingLanguage(true)

    try {
      // 在路由跳转前同步写 cookie，避免竞态
      setCookie(cookieName, newLng, { path: '/' })

      const currentPath = location.pathname
      const pathWithoutLang = currentPath.replace(`/${lng}`, '') || '/'
      await router.push(`/${newLng}${pathWithoutLang}`)
      router.refresh()
    }
    catch (error) {
      console.error('Language change failed:', error)
      setIsChangingLanguage(false)
    }
  }

  return (
    <SettingsSection title={t('nav.appearance')} desc={t('appearance.desc')}>
      <SettingsCard title={t('general.theme')} desc={t('general.themeDesc')}>
        <div
          className="flex flex-wrap gap-4 md:gap-5"
          role="radiogroup"
          aria-label={t('general.theme')}
        >
          {themeOptions.map((option) => {
            const isActive = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setTheme(option.value)}
                className="group flex flex-col items-center gap-2.5 rounded-lg"
              >
                <div
                  className={cn(
                    'relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-all md:h-18 md:w-28',
                    isActive
                      ? 'border-primary shadow-sm'
                      : 'border-border group-hover:border-muted-foreground',
                  )}
                >
                  <Image src={option.image} alt={t(option.labelKey)} fill className="object-cover" />
                </div>
                <span
                  className={cn(
                    'text-sm transition-colors',
                    isActive ? 'font-medium text-primary' : 'text-muted-foreground',
                  )}
                >
                  {t(option.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-language">{t('general.language')}</Label>
          <Select value={lng} onValueChange={handleLanguageChange} disabled={isChangingLanguage}>
            <SelectTrigger id="settings-language" className="h-9 w-full sm:max-w-xs">
              {isChangingLanguage
                ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span className="text-muted-foreground">{t('general.changingLanguage')}</span>
                    </span>
                  )
                : <SelectValue />}
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('general.languageDesc')}
          </p>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
