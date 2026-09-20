/**
 * 设置页分区外壳
 * 分区标题 + 说明 + 卡片，只管排版，三个分区共用，保证留白一致。
 */

'use client'

import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/utils/className'

interface SettingsSectionProps {
  title: string
  desc: string
  children: ReactNode
}

/** 一个分区：左对齐标题 + 说明，下面跟若干卡片 */
export function SettingsSection({ title, desc, children }: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold text-foreground md:text-xl">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{desc}</p>
      </header>
      {children}
    </section>
  )
}

interface SettingsCardProps {
  /** 卡片自己的小标题，可不给 */
  title?: string
  /** 小标题下面的说明 */
  desc?: string
  children: ReactNode
  className?: string
}

/** 分区里的一块内容。留白统一在这里给，别在调用处各写各的 */
export function SettingsCard({ title, desc, children, className }: SettingsCardProps) {
  return (
    <Card className={cn('rounded-xl border-border p-5 shadow-none md:p-6', className)}>
      {(title || desc) && (
        <div className="mb-5">
          {title && <h3 className="text-sm font-medium text-foreground">{title}</h3>}
          {desc && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{desc}</p>
          )}
        </div>
      )}
      {children}
    </Card>
  )
}
