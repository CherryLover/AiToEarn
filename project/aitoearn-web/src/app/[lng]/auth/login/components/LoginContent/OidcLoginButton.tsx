/**
 * OidcLoginButton - 用 Pocket ID（OIDC）登录
 * 自部署版后台只有这一种登录方式：跳到后台的登录入口，登录完回到 /auth/oidc-callback
 */

'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { useGetClientLng } from '@/hooks/useSystem'

export function OidcLoginButton() {
  const { t } = useTransClient('login')
  const lng = useGetClientLng()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const errorCode = searchParams?.get('oidc_error')

  const handleLogin = () => {
    setLoading(true)
    const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api'
    window.location.href = `${apiBase}/auth/oidc/login?lng=${encodeURIComponent(lng)}`
  }

  return (
    <div className="flex flex-col gap-3">
      {errorCode && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
          {t(`oidcErrors.${errorCode}`, { defaultValue: t('oidcErrors.default') })}
        </p>
      )}
      <Button className="h-11 w-full" loading={loading} onClick={handleLogin}>
        {t('oidcLoginButton')}
      </Button>
    </div>
  )
}
