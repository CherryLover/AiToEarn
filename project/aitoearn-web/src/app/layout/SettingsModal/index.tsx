/**
 * SettingsModal - 设置入口（已经不是弹框了）
 *
 * 设置从弹框搬到了独立页面 `/[lng]/settings`：左边分区导航、右边内容区，
 * 一屏一件事，输入框有标签有说明，不再挤在一个 900px 的框里。
 *
 * 这个文件留着不删，是因为侧边栏、移动端抽屉、用户下拉菜单都还在调
 * `useSettingsModalStore().openSettings()`，那几个文件不归这一轮改。
 * 所以组件名和 props 原样保留，行为改成「跳到设置页对应分区」。
 * 以后谁来收尾，可以把那几处直接换成 `<Link href="/settings">`，然后删掉这里和 store。
 */

'use client'

import type { SettingsTab } from '@/store/settingsModal'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useGetClientLng } from '@/hooks/useSystem'

/** 设置页面类型（导出供外部使用） */
export type { SettingsTab } from '@/store/settingsModal'

/** 弹框时代的 tab 名 → 设置页分区 hash */
const TAB_TO_SECTION: Record<SettingsTab, string> = {
  profile: 'profile',
  general: 'appearance',
}

export interface SettingsModalProps {
  /** 是否要打开设置（现在等于「是否要跳转」） */
  open: boolean
  /** 关闭回调，跳转后立刻调一次，把 store 的标记清掉 */
  onClose: () => void
  /** 默认分区 */
  defaultTab?: SettingsTab
}

/**
 * 不渲染任何东西：`open` 变成 true 就跳到设置页。
 */
export function SettingsModal({ open, onClose, defaultTab }: SettingsModalProps) {
  const router = useRouter()
  const lng = useGetClientLng()

  useEffect(() => {
    if (!open)
      return

    const section = defaultTab ? TAB_TO_SECTION[defaultTab] : ''
    router.push(`/${lng}/settings${section ? `#${section}` : ''}`)
    onClose()
  }, [open, defaultTab, lng, onClose, router])

  return null
}

export default SettingsModal
