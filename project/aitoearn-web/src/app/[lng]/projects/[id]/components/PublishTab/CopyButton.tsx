/**
 * CopyButton - 带明确反馈的复制按钮
 * 点完按钮本身变成「已复制」并弹一条提示，两秒后复原；复制不成功也要说一声。
 */
'use client'

import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { toast } from '@/utils/ui/toast'
import { COPY_FEEDBACK_MS } from './publish.constants'
import { copyToClipboard } from './publish.utils'

interface CopyButtonProps {
  /** 要复制的内容，空字符串时按钮禁用 */
  text: string
  /** 按钮文字，不传只显示图标 */
  label?: string
  variant?: 'outline' | 'ghost' | 'secondary' | 'default'
  size?: 'sm' | 'icon' | 'default'
  className?: string
}

export function CopyButton({
  text,
  label,
  variant = 'outline',
  size = 'sm',
  className,
}: CopyButtonProps) {
  const { t } = useTransClient('projects')

  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current)
        clearTimeout(timerRef.current)
    },
    [],
  )

  const handleCopy = async () => {
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast.error(t('publish.card.copyFailed'))
      return
    }

    setCopied(true)
    toast.success(t('publish.card.copied'))

    if (timerRef.current)
      clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={label ? size : 'icon'}
      className={className}
      disabled={!text}
      aria-label={label ?? t('publish.card.copy')}
      onClick={handleCopy}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {label ? (copied ? t('publish.card.copied') : label) : null}
    </Button>
  )
}
