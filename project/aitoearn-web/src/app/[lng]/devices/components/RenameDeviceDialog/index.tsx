/**
 * RenameDeviceDialog - 改设备名对话框
 * 只改名字，能力、版本、账号这些都由插件上报，网页不碰
 */
'use client'

import type { Device } from '@/api/devices/device.types'
import { useEffect, useState } from 'react'
import { updateDeviceApi } from '@/api/devices/device.api'
import { DEVICE_NAME_MAX_LENGTH } from '@/api/devices/device.constants'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/utils/ui/toast'
import { getDeviceErrorKey } from '../../devices.utils'

interface RenameDeviceDialogProps {
  device: Device
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 改名成功回调，由父组件负责刷新 */
  onRenamed: () => void
}

export function RenameDeviceDialog({
  device,
  open,
  onOpenChange,
  onRenamed,
}: RenameDeviceDialogProps) {
  const { t } = useTransClient('devices')

  const [name, setName] = useState(device.name)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 每次打开都回到当前名字，避免上一次的输入残留
  useEffect(() => {
    if (open) {
      setName(device.name)
      setIsSubmitting(false)
    }
  }, [open, device.name])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= DEVICE_NAME_MAX_LENGTH && !isSubmitting

  const handleSubmit = async () => {
    if (!canSubmit)
      return

    setIsSubmitting(true)
    try {
      const res = await updateDeviceApi(device.id, { name: trimmed })
      if (res && res.code === 0) {
        toast.success(t('rename.success'))
        onRenamed()
        onOpenChange(false)
        return
      }

      toast.error(t(getDeviceErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Rename device failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(440px,95vw)]">
        <DialogHeader>
          <DialogTitle>{t('rename.title')}</DialogTitle>
          <DialogDescription>{t('rename.desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="device-name">{t('rename.label')}</Label>
          <Input
            id="device-name"
            value={name}
            maxLength={DEVICE_NAME_MAX_LENGTH}
            placeholder={t('rename.placeholder')}
            onChange={e => setName(e.target.value)}
          />
          {trimmed.length === 0 && (
            <p className="text-xs text-destructive">{t('rename.emptyError')}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('action.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? t('action.saving') : t('action.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
