'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useTransClient } from '@/app/i18n/client'
import { useGetClientLng } from '@/hooks/useSystem'
import { useUserStore } from '@/store/user'

export default function OidcCallbackContent() {
  const router = useRouter()
  const lng = useGetClientLng()
  const { t } = useTransClient('login')
  const hasHydrated = useUserStore(state => state._hasHydrated)

  useEffect(() => {
    if (!hasHydrated)
      return

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
    // 立刻把凭证从地址栏抹掉，避免留在浏览记录里
    window.history.replaceState(null, '', window.location.pathname)

    if (!token) {
      router.replace(`/${lng}/auth/login?oidc_error=token_missing`)
      return
    }

    const store = useUserStore.getState()
    store.setToken(token)
    store.appInit()
    router.replace(`/${lng}`)
  }, [hasHydrated, lng, router])

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      {t('oidcLoggingIn')}
    </div>
  )
}
