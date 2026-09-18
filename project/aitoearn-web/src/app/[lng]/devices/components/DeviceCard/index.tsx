/**
 * DeviceCard - 设备卡片
 * 名字、在线状态、最后心跳、插件版本、能干哪些平台、登录了哪些号，外加改名、吊销和最近工单
 */
'use client'

import type { Device } from '@/api/devices/device.types'
import { ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { revokeDeviceApi } from '@/api/devices/device.api'
import { useTransClient } from '@/app/i18n/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils/className'
import { formatDate } from '@/utils/format'
import { toast } from '@/utils/ui/toast'
import { getCapabilityLabelKey, getDeviceErrorKey } from '../../devices.utils'
import { DeviceTaskList } from '../DeviceTaskList'
import { RenameDeviceDialog } from '../RenameDeviceDialog'

interface DeviceCardProps {
  device: Device
  /** 改名、吊销之后让父组件重新拉列表 */
  onChanged: () => void
}

export function DeviceCard({ device, onChanged }: DeviceCardProps) {
  const { t } = useTransClient('devices')

  const [renameOpen, setRenameOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)

  const isOnline = device.online
  const capabilities = device.capabilities ?? []
  const accounts = device.accounts ?? []

  const handleRevoke = async () => {
    setIsRevoking(true)
    try {
      const res = await revokeDeviceApi(device.id)
      if (res && res.code === 0) {
        toast.success(t('revoke.success'))
        setRevokeOpen(false)
        onChanged()
        return
      }

      toast.error(t(getDeviceErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Revoke device failed:', error)
      toast.error(t('error.unknown'))
    }
    finally {
      setIsRevoking(false)
    }
  }

  return (
    <div
      className="flex flex-col rounded-xl border border-border bg-card p-4"
      data-testid={`device-card-${device.id}`}
    >
      {/* 名字与状态 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-base font-medium text-foreground">
              {device.name}
            </h3>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
                isOnline
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isOnline ? 'bg-emerald-500' : 'bg-muted-foreground',
                )}
              />
              {isOnline ? t('device.status.online') : t('device.status.offline')}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {device.lastSeenAt
              ? t('device.lastSeen', { time: formatDate(device.lastSeenAt) })
              : t('device.neverSeen')}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
            <Pencil className="size-4" />
            {t('action.rename')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRevokeOpen(true)}>
            <Trash2 className="size-4" />
            {t('action.revoke')}
          </Button>
        </div>
      </div>

      {/* 版本与机器 */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>{t('device.version', { version: device.version || t('device.unknown') })}</span>
        <span>{t('device.platform', { platform: device.platform || t('device.unknown') })}</span>
        <span>{t('device.pairedAt', { time: formatDate(device.createdAt) })}</span>
      </div>

      {/* 能干哪些平台 */}
      <div className="mt-3">
        <p className="text-xs text-muted-foreground">{t('device.capabilities')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {capabilities.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('device.noCapabilities')}</span>
          ) : (
            capabilities.map((capability) => {
              const labelKey = getCapabilityLabelKey(capability)
              return (
                <Badge key={capability} variant="secondary">
                  {labelKey ? t(labelKey) : capability}
                </Badge>
              )
            })
          )}
        </div>
      </div>

      {/* 登录了哪些号 */}
      <div className="mt-3">
        <p className="text-xs text-muted-foreground">{t('device.accounts')}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {accounts.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('device.noAccounts')}</span>
          ) : (
            accounts.map((account) => {
              const labelKey = getCapabilityLabelKey(account.platform)
              return (
                <Badge
                  key={`${account.platform}-${account.accountId ?? account.accountName ?? ''}`}
                  variant="outline"
                >
                  {account.accountName
                    ? `${labelKey ? t(labelKey) : account.platform} · ${account.accountName}`
                    : labelKey ? t(labelKey) : account.platform}
                </Badge>
              )
            })
          )}
        </div>
      </div>

      {/* 最近工单 */}
      <div className="mt-4 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          onClick={() => setTasksOpen(prev => !prev)}
        >
          {tasksOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {tasksOpen ? t('action.hideTasks') : t('action.viewTasks')}
        </Button>
        {tasksOpen && (
          <div className="mt-3">
            <DeviceTaskList deviceId={device.id} />
          </div>
        )}
      </div>

      {/* 改名 */}
      <RenameDeviceDialog
        device={device}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRenamed={onChanged}
      />

      {/* 吊销二次确认 */}
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revoke.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('revoke.desc', { name: device.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>{t('action.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRevoking}
              onClick={(event) => {
                // 交给异步流程控制关闭时机，避免请求没回来就把弹窗关了
                event.preventDefault()
                handleRevoke()
              }}
            >
              {isRevoking ? t('revoke.revoking') : t('revoke.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
