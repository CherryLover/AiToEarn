/**
 * 配置管理页分区外壳
 *
 * 排版规则（标题 + 说明 + 卡片、留白、圆角、边框）和设置页的
 * `app/[lng]/settings/components/SettingsSection.tsx` 保持一字不差，
 * 让两个页面看起来是同一套东西。
 *
 * 这里是照抄不是引用：按仓库约定（AGENTS.md「页面私有组件放在 pages/xxx/components/」），
 * 页面私有组件不跨页面互相 import；等第三个页面也要用的时候再提到公共目录。
 *
 * 和设置页唯一的差别：`ConfigCard` 转发 ref 和剩余属性，
 * 因为配置页的卡片整张是可折叠的（`Collapsible asChild` 要往下挂 ref 和 data 属性）。
 */

'use client'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { forwardRef } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/utils/className'

interface ConfigSectionShellProps {
  title: string
  desc?: string
  /** 标题右边的小标记，比如「不推荐」 */
  badge?: ReactNode
  /** 标题下面、卡片上面的一条工具栏，比如搜索框 */
  toolbar?: ReactNode
  children: ReactNode
}

/** 一个分区：左对齐标题 + 说明，下面跟若干卡片 */
export function ConfigSectionShell({ title, desc, badge, toolbar, children }: ConfigSectionShellProps) {
  return (
    <section className="flex flex-col gap-6">
      <header className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground md:text-xl">{title}</h2>
          {badge}
        </div>
        {desc && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{desc}</p>
        )}
      </header>
      {toolbar}
      {children}
    </section>
  )
}

type ConfigCardProps = ComponentPropsWithoutRef<'div'>

/** 分区里的一块内容。留白统一在这里给，别在调用处各写各的 */
export const ConfigCard = forwardRef<HTMLDivElement, ConfigCardProps>(
  ({ children, className, ...props }, ref) => (
    <Card ref={ref} className={cn('rounded-xl border-border p-5 shadow-none md:p-6', className)} {...props}>
      {children}
    </Card>
  ),
)
ConfigCard.displayName = 'ConfigCard'
