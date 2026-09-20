/**
 * ConfigManagerDialog - 已经不是弹窗了，只是个跳转壳子
 *
 * 配置管理搬成了独立页面 `src/app/[lng]/config/`。这里之所以还留着，是因为有三处
 * 仍然通过 `useConfigManagerDialogStore` 请求「打开配置管理」：
 * 侧边栏入口、接口报错提示里的「点击查看配置」、以及 `Providers` 的挂载点。
 *
 * 所以这个组件的全部职责就是：被要求打开时，关掉 store 的开关并跳到配置页。
 * **这里不允许再出现任何配置编辑的实现**，那一套只有一份，在页面目录里。
 */
'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useGetClientLng } from '@/hooks/useSystem'

export interface ConfigManagerDialogProps {
  open: boolean
  onClose: () => void
}

export function ConfigManagerDialog({ open, onClose }: ConfigManagerDialogProps) {
  const router = useRouter()
  const lng = useGetClientLng()

  useEffect(() => {
    if (!open)
      return

    // 先把开关关掉，免得跳到页面之后 store 还记着「开着」，下次再点没反应
    onClose()
    router.push(`/${lng}/config`)
  }, [lng, onClose, open, router])

  return null
}

export default ConfigManagerDialog
