/**
 * 设备页内容组件 - Devices Content
 * 客户端组件，负责设备列表拉取、添加设备对话框，以及「设备 / 工单」两个标签页
 */
'use client'

import type { Device } from '@/api/devices/device.types'
import { MonitorSmartphone, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getDeviceListApi } from '@/api/devices/device.api'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDocumentTitle } from '@/hooks'
import { toast } from '@/utils/ui/toast'
import { AddDeviceDialog } from './components/AddDeviceDialog'
import { DeviceCard } from './components/DeviceCard'
import { TasksTab } from './components/TasksTab'

/** 骨架屏占位数量 */
const SKELETON_KEYS = ['s1', 's2', 's3']

/** 标签页顺序 */
const TABS = ['devices', 'tasks'] as const

export function DevicesPageContent() {
  const { t } = useTransClient('devices')

  useDocumentTitle(t('page.title'))

  const [devices, setDevices] = useState<Device[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  /** 拉设备列表，在线状态由服务端按最后心跳算好 */
  const loadDevices = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await getDeviceListApi()
      if (res && res.code === 0) {
        setDevices(Array.isArray(res.data) ? res.data : [])
      }
      else {
        setDevices([])
        toast.error(t('device.loadFailed'))
      }
    }
    catch (error) {
      console.error('Load device list failed:', error)
      setDevices([])
      toast.error(t('device.loadFailed'))
    }
    finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  const isEmpty = !isLoading && devices.length === 0

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      {/* 页头 */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('page.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadDevices} disabled={isLoading}>
            <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
            {t('action.refresh')}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            {t('action.addDevice')}
          </Button>
        </div>
      </header>

      {/* 设备 / 工单 */}
      <div className="mt-6">
        <Tabs defaultValue={TABS[0]}>
          <TabsList>
            {TABS.map(tab => (
              <TabsTrigger key={tab} value={tab}>
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="devices">
            {isLoading ? (
              <div className="grid gap-4">
                {SKELETON_KEYS.map(key => (
                  <Skeleton key={key} className="h-[148px] w-full rounded-xl" />
                ))}
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MonitorSmartphone className="size-6" />
                </div>
                <h2 className="text-base font-medium text-foreground">{t('empty.title')}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {t('empty.desc')}
                </p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {t('empty.hint')}
                </p>
                <Button className="mt-6" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" />
                  {t('empty.action')}
                </Button>
              </div>
            ) : (
              <div className="grid gap-4">
                {devices.map(device => (
                  <DeviceCard key={device.id} device={device} onChanged={loadDevices} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="tasks">
            <TasksTab devices={devices} />
          </TabsContent>
        </Tabs>
      </div>

      {/* 添加设备：出配对码 */}
      <AddDeviceDialog open={addOpen} onOpenChange={setAddOpen} onDone={loadDevices} />
    </div>
  )
}
