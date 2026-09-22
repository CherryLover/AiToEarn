/**
 * Google 登录的 Provider，**只包在真正要画 Google 按钮的地方**。
 *
 * 它原来挂在 `Providers.tsx` 的最外层，于是每一个页面、每一次进站都会去加载
 * `accounts.google.com/gsi/client`。这个域名在国内连不上，浏览器会一直等它，
 * 标签页的转圈就停不下来——用户看到的是「主站一直在 loading，但页面上没有任何内容」。
 *
 * 而这个 fork 的登录页（`LoginContent/index.tsx`）已经只留 Pocket ID（OIDC）了，
 * Google 按钮根本画不出来。为一个画不出来的按钮，让所有人每次进站都卡一次，不划算。
 *
 * 所以规矩是：**谁用谁包**。以后哪个表单要画 Google 按钮，就在那一段外面套这个组件，
 * 脚本跟着按钮一起出现，不出现就一个请求都不发。
 */

'use client'

import { GoogleOAuthProvider } from '@react-oauth/google'
import { useLayoutEffect } from 'react'

const GIS_URL = 'https://accounts.google.com/gsi/client'

const GOOGLE_CLIENT_ID = '1094109734611-flskoscgp609mecqk9ablvc6i3205vqk.apps.googleusercontent.com'

export function GoogleAuthScope({ lng, children }: { lng: string, children: React.ReactNode }) {
  // 拦截 @react-oauth/google 的脚本加载，添加 ?hl= 参数以设置按钮语言
  useLayoutEffect(() => {
    const hl = lng.replace('-', '_')
    const originalAppendChild = document.body.appendChild.bind(document.body)

    document.body.appendChild = function <T extends Node>(node: T): T {
      if (node instanceof HTMLScriptElement && node.src === GIS_URL) {
        node.src = `${GIS_URL}?hl=${hl}`
      }
      return originalAppendChild(node)
    }

    return () => {
      document.body.appendChild = originalAppendChild
    }
  }, [lng])

  return <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{children}</GoogleOAuthProvider>
}
