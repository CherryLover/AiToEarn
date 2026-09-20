'use client'

import type { CSSProperties } from 'react'
import type { ToasterProps } from 'sonner'
import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

/**
 * Toaster - 全站 toast 容器
 *
 * 配色全部走主题变量，不写死色板：
 * sonner 自己的样式表读的是 `--normal-*` / `--success-*` / `--error-*` 等一组变量，
 * 这里在容器根节点用行内 style 覆盖它们，指到 globals.css 的主题变量上。
 * 行内 style 的优先级高于 sonner 注入的样式表，不用靠 `!important` 或类名去抢，
 * 亮色 / 暗色也就跟着 `.dark` 自动切换，不需要在这里各写一套。
 *
 * `theme` 从 next-themes 取：sonner 的关闭按钮、取消按钮有自己的一套亮/暗规则，
 * 不把当前主题告诉它的话，暗色下这两个控件会用亮色值，几乎看不见。
 */
export function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps['theme']}
      className="toaster group"
      style={{
        '--border-radius': 'var(--radius)',

        // 普通 toast
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
        '--normal-bg-hover': 'var(--accent)',
        '--normal-border-hover': 'var(--border)',

        // 语义态：底色是主题色按低比例混进弹层底色（不透明，页面不会透上来）；
        // 文字往前景色方向混，保证压在浅底上也够黑。
        // 混色空间用 oklab 不用 oklch：oklch 是极坐标，和近中性的前景/弹层底色混时
        // 会把色相一起插值，实测 info 蓝混出来是紫的、success 绿混出来是橄榄色。
        // oklab 是直角坐标，近中性色的 a/b 接近 0，只会变深变淡，不会转色相。
        '--success-bg': 'color-mix(in oklab, var(--success) 12%, var(--popover))',
        '--success-border': 'color-mix(in oklab, var(--success) 40%, var(--border))',
        '--success-text': 'color-mix(in oklab, var(--success) 65%, var(--foreground))',

        '--error-bg': 'color-mix(in oklab, var(--destructive) 12%, var(--popover))',
        '--error-border': 'color-mix(in oklab, var(--destructive) 40%, var(--border))',
        '--error-text': 'color-mix(in oklab, var(--destructive) 65%, var(--foreground))',

        '--warning-bg': 'color-mix(in oklab, var(--warning) 12%, var(--popover))',
        '--warning-border': 'color-mix(in oklab, var(--warning) 40%, var(--border))',
        '--warning-text': 'color-mix(in oklab, var(--warning) 65%, var(--foreground))',

        '--info-bg': 'color-mix(in oklab, var(--info) 12%, var(--popover))',
        '--info-border': 'color-mix(in oklab, var(--info) 40%, var(--border))',
        '--info-text': 'color-mix(in oklab, var(--info) 65%, var(--foreground))',
      } as CSSProperties}
      {...props}
    />
  )
}
