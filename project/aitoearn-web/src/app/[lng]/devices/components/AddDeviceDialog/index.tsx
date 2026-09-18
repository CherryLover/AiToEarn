/**
 * AddDeviceDialog - 添加设备对话框
 * 出一个 8 位配对码，带倒计时和一键复制，说清楚要去浏览器插件里填
 */
'use client'

import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createDevicePairingCodeApi } from '@/api/devices/device.api'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/utils/ui/toast'
import { formatCountdown, getDeviceErrorKey, getRemainingSeconds } from '../../devices.utils'

interface AddDeviceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 关闭时回调，父组件借机刷新设备列表——配对可能已经在插件那边完成了 */
  onDone: () => void
}

/** 配对步骤，文案键在 devices 命名空间下 */
const PAIR_STEPS = ['pair.step1', 'pair.step2', 'pair.step3'] as const

export function AddDeviceDialog({ open, onOpenChange, onDone }: AddDeviceDialogProps) {
  const { t } = useTransClient('devices')

  const [code, setCode] = useState('')
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const requestCode = useCallback(async () => {
    setIsLoading(true)
    setCopied(false)
    try {
      const res = await createDevicePairingCodeApi()
      if (res && res.code === 0 && res.data?.code) {
        setCode(res.data.code)
        setExpiresAt(res.data.expiresAt)
        setRemaining(getRemainingSeconds(res.data.expiresAt))
        return
      }

      setCode('')
      setExpiresAt(null)
      setRemaining(0)
      toast.error(t(getDeviceErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Create device pairing code failed:', error)
      setCode('')
      setExpiresAt(null)
      setRemaining(0)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsLoading(false)
    }
  }, [t])

  // 每次打开都重新要一个码，上一次的残留不再显示
  useEffect(() => {
    if (!open) {
      setCode('')
      setExpiresAt(null)
      setRemaining(0)
      setCopied(false)
      return
    }
    requestCode()
  }, [open, requestCode])

  // 倒计时：只在弹窗开着且码没过期时跑
  useEffect(() => {
    if (!open || !expiresAt)
      return

    const timer = setInterval(() => {
      setRemaining(getRemainingSeconds(expiresAt))
    }, 1000)

    return () => clearInterval(timer)
  }, [open, expiresAt])

  const isExpired = Boolean(code) && remaining <= 0

  const handleCopy = async () => {
    if (!code)
      return

    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success(t('pair.copySuccess'))
      setTimeout(() => setCopied(false), 2000)
    }
    catch (error) {
      console.error('Copy pairing code failed:', error)
      toast.error(t('pair.copyFailed'))
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    onDone()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next)
          onDone()
      }}
    >
      <DialogContent className="sm:w-[min(520px,95vw)]">
        <DialogHeader>
          <DialogTitle>{t('pair.title')}</DialogTitle>
          <DialogDescription>{t('pair.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 配对码 */}
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-6">
            {isLoading ? (
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            ) : code ? (
              <>
                <p
                  className="select-all font-mono text-3xl font-semibold tracking-[0.4em] text-foreground"
                  data-testid="device-pairing-code"
                >
                  {code}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isExpired
                    ? t('pair.expired')
                    : t('pair.expiresIn', { time: formatCountdown(remaining) })}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy} disabled={isExpired}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {t('action.copy')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={requestCode} disabled={isLoading}>
                    <RefreshCw className="size-4" />
                    {t('action.regenerate')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('pair.generateFailed')}</p>
                <Button variant="outline" size="sm" onClick={requestCode}>
                  <RefreshCw className="size-4" />
                  {t('action.regenerate')}
                </Button>
              </>
            )}
          </div>

          {/* 怎么用 */}
          <ol className="flex flex-col gap-2">
            {PAIR_STEPS.map((step, index) => (
              <li key={step} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-foreground">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{t(step)}</span>
              </li>
            ))}
          </ol>
        </div>

        <DialogFooter>
          <Button onClick={handleClose}>{t('pair.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
