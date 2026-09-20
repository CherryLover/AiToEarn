/**
 * 配置管理页内容组件
 *
 * 这一版只做一件事：把原来的全局弹窗（`app/layout/ConfigManagerDialog`）搬成独立页面，
 * 外壳和交互约定照设置页（`app/[lng]/settings`）抄——左边分区导航、右边内容区、
 * 显式保存按钮、反馈走 toast、手机宽度下导航换行不做横向滚动。
 *
 * **功能一个字没动**：读取、校验、保存、重启、恢复检查走的还是同一套接口和同一套流程。
 *
 * 需要知道但这一轮不修的事：当前部署把配置文件以只读方式挂进容器（`:ro`），
 * 所以保存必然失败；就算写进去了，下次部署也会被 `.env` + overrides 重新渲染覆盖。
 * 这是两套配置模型打架，要认真设计权限和审计才能解，不在这一轮范围里。
 * 这一轮能做的是**别把失败原因藏起来**——见 `config.utils.ts` 里 `formatConfigFailure` 的说明。
 */
'use client'

import type { ConfigApiFailure } from './config.utils'
import type { ConfigEditorStatus, ConfigPath, ConfigPathFocusRequest, ConfigValue } from './types'
import { AlertCircle, Bot, Braces, CheckCircle2, FileSliders, Loader2, RefreshCw, RotateCcw, Save, Server, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  checkConfigEditorConfigReadyApi,
  getConfigEditorConfigApi,
  restartConfigEditorServiceApi,
  saveConfigEditorConfigApi,
  validateConfigEditorConfigApi,
} from '@/api/config-editor/config-editor.api'
import { ConfigEditorServiceTarget } from '@/api/config-editor/config-editor.types'
import { useTransClient } from '@/app/i18n/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDocumentTitle } from '@/hooks'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { ConfigFormPanel } from './components/ConfigFormPanel'
import { ConfigJsonPanel } from './components/ConfigJsonPanel'
import { ConfigCard, ConfigSectionShell } from './components/ConfigSection'
import { ConfigSectionNav } from './components/ConfigSectionNav'
import {
  ensureRelayConfig,
  formatConfigFailure,
  formatJsonConfig,
  isConfigEditorServiceTarget,
  readApiFailure,
  readThrownFailure,
  stripInsertedRelayPlaceholder,
} from './config.utils'
import { isRecord, joinPath, setValueAtPath, stableStringify } from './utils/configPath'
import { buildConfigSections } from './utils/configSections'

type LoadingAction = 'load' | 'validate' | 'save' | 'saveRestart' | 'restart'
type ConfigEditMode = 'visual' | 'json'

/** 页面上展示的一条失败：标题说是哪一步失败，正文是服务端的原话 */
interface ConfigPageError {
  title: string
  description: string
}

const healthCheckIntervalMs = 1600
const healthCheckMaxAttempts = 75

function StatusBadge({ status }: { status: ConfigEditorStatus }) {
  const { t } = useTransClient('configManager')

  if (status.service === 'restarting') {
    return (
      <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 font-normal text-warning-text">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('status.restarting')}
      </Badge>
    )
  }

  if (status.service === 'failed') {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 font-normal text-destructive">
        <AlertCircle className="h-3 w-3" />
        {t('status.failed')}
      </Badge>
    )
  }

  if (status.service === 'running') {
    return (
      <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 font-normal text-success-text">
        <CheckCircle2 className="h-3 w-3" />
        {t('status.running')}
      </Badge>
    )
  }

  return <Badge variant="secondary" className="font-normal">{t('status.unknown')}</Badge>
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

export function ConfigPageContent() {
  const { t } = useTransClient('configManager')

  useDocumentTitle(t('page.title'))

  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [originalConfig, setOriginalConfig] = useState<Record<string, unknown> | null>(null)
  const [format, setFormat] = useState<ConfigEditorStatus['format']>()
  const [loadingAction, setLoadingAction] = useState<LoadingAction | null>('load')
  const [error, setError] = useState<ConfigPageError | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [healthAttempts, setHealthAttempts] = useState(0)
  const [serviceStatus, setServiceStatus] = useState<ConfigEditorStatus['service']>('unknown')
  const [serviceTarget, setServiceTarget] = useState(ConfigEditorServiceTarget.Server)
  const [insertedRelayPath, setInsertedRelayPath] = useState<ConfigPath | null>(null)
  const [editMode, setEditMode] = useState<ConfigEditMode>('visual')
  const [jsonText, setJsonText] = useState('')
  const [activeSectionId, setActiveSectionId] = useState('')
  /** 配置项搜索词。跨分区搜，所以放在页面这一层，切分区或切服务时清掉 */
  const [searchQuery, setSearchQuery] = useState('')
  const [visualFocusRequest, setVisualFocusRequest] = useState<ConfigPathFocusRequest | null>(null)
  const [jsonFocusRequest, setJsonFocusRequest] = useState<ConfigPathFocusRequest | null>(null)
  const [highlightedVisualPathKey, setHighlightedVisualPathKey] = useState('')
  const [highlightedJsonPathKey, setHighlightedJsonPathKey] = useState('')
  const [jsonScrollTop, setJsonScrollTop] = useState(0)
  const focusRequestIdRef = useRef(0)
  const visualHighlightTimerRef = useRef<number | null>(null)
  const jsonHighlightTimerRef = useRef<number | null>(null)
  /** 首屏从 URL hash 里带过来的分区，等分区列表算出来再认领 */
  const pendingSectionIdRef = useRef<string>('')

  /** 只给 formatConfigFailure 用：把 t 收成一个稳定的两参函数 */
  const translateFailure = useCallback(
    (key: string, options?: Record<string, unknown>) => (options ? t(key, options) : t(key)),
    [t],
  )

  const reportFailure = useCallback((titleKey: string, failure: ConfigApiFailure) => {
    const description = formatConfigFailure(failure, translateFailure)
    setError({ title: t(titleKey), description })
    // toast 只放一句话，完整原因留在页面上的 Alert 里，免得被 3 秒吞掉
    toast.error(`${t(titleKey)}：${description}`)
  }, [t, translateFailure])

  const dirty = useMemo(() => {
    if (!config || !originalConfig)
      return false
    if (editMode === 'json')
      return jsonText.trim() !== formatJsonConfig(originalConfig)
    return stableStringify(config) !== stableStringify(originalConfig)
  }, [config, editMode, jsonText, originalConfig])

  const sections = useMemo(
    () => config ? buildConfigSections(config, originalConfig, serviceTarget, t) : [],
    [config, originalConfig, serviceTarget, t],
  )

  // 分区列表是配置加载完才有的，所以 hash 只能等在这里认领
  useEffect(() => {
    if (sections.length === 0)
      return

    const pendingId = pendingSectionIdRef.current
    if (pendingId && sections.some(section => section.id === pendingId)) {
      pendingSectionIdRef.current = ''
      setActiveSectionId(pendingId)
      return
    }

    setActiveSectionId((current) => {
      if (current && sections.some(section => section.id === current))
        return current
      return sections[0].id
    })
  }, [sections])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    pendingSectionIdRef.current = window.location.hash.replace('#', '')
  }, [])

  const activeSection = sections.find(section => section.id === activeSectionId) ?? sections[0]
  const disabled = !!loadingAction || serviceStatus === 'restarting'
  const serverServiceDisabled = disabled || (dirty && serviceTarget !== ConfigEditorServiceTarget.Server)
  const aiServiceDisabled = disabled || (dirty && serviceTarget !== ConfigEditorServiceTarget.Ai)

  const handleSectionSelect = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId)
    // 点了分区就是要看这个分区，搜索结果还挂在上面只会挡路
    setSearchQuery('')
    if (typeof window !== 'undefined')
      window.history.replaceState(null, '', `#${sectionId}`)
  }, [])

  const clearVisualHighlightLater = useCallback(() => {
    if (visualHighlightTimerRef.current !== null)
      window.clearTimeout(visualHighlightTimerRef.current)
    visualHighlightTimerRef.current = window.setTimeout(() => setHighlightedVisualPathKey(''), 1800)
  }, [])

  const clearJsonHighlightLater = useCallback(() => {
    if (jsonHighlightTimerRef.current !== null)
      window.clearTimeout(jsonHighlightTimerRef.current)
    jsonHighlightTimerRef.current = window.setTimeout(() => setHighlightedJsonPathKey(''), 1800)
  }, [])

  useEffect(() => {
    return () => {
      if (visualHighlightTimerRef.current !== null)
        window.clearTimeout(visualHighlightTimerRef.current)
      if (jsonHighlightTimerRef.current !== null)
        window.clearTimeout(jsonHighlightTimerRef.current)
    }
  }, [])

  const loadConfig = useCallback(async () => {
    setLoadingAction('load')
    setError(null)
    setSuccessMessage('')

    try {
      const response = await getConfigEditorConfigApi(serviceTarget, true)
      if (!response || response.code !== 0 || !response.data?.config) {
        setServiceStatus('failed')
        reportFailure('errors.loadFailed', readApiFailure(response))
        return
      }

      const normalizedConfig = ensureRelayConfig(response.data.config, serviceTarget)
      setConfig(normalizedConfig.config)
      setOriginalConfig(normalizedConfig.config)
      setJsonText(formatJsonConfig(normalizedConfig.config))
      setVisualFocusRequest(null)
      setJsonFocusRequest(null)
      setHighlightedVisualPathKey('')
      setHighlightedJsonPathKey('')
      setJsonScrollTop(0)
      setInsertedRelayPath(normalizedConfig.insertedRelayPath)
      setFormat(response.data.format)
      setServiceStatus('running')
      setHealthAttempts(0)
    }
    catch (loadError) {
      setServiceStatus('failed')
      reportFailure('errors.loadFailed', readThrownFailure(loadError))
    }
    finally {
      setLoadingAction(null)
    }
  }, [reportFailure, serviceTarget])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleServiceTargetChange = useCallback((value: string) => {
    if (!isConfigEditorServiceTarget(value))
      return

    setServiceTarget(value)
    setLoadingAction('load')
    setConfig(null)
    setOriginalConfig(null)
    setJsonText('')
    setInsertedRelayPath(null)
    setFormat(undefined)
    setHealthAttempts(0)
    setServiceStatus('unknown')
    setEditMode('visual')
    setActiveSectionId('')
    setSearchQuery('')
    setVisualFocusRequest(null)
    setJsonFocusRequest(null)
    setHighlightedVisualPathKey('')
    setHighlightedJsonPathKey('')
    setJsonScrollTop(0)
    setError(null)
    setSuccessMessage('')
  }, [])

  const handleValueChange = useCallback((path: ConfigPath, value: ConfigValue) => {
    setConfig((current) => {
      if (!current)
        return current
      const nextConfig = setValueAtPath(current, path, value)
      setJsonText(formatJsonConfig(nextConfig))
      return nextConfig
    })
    setError(null)
    setSuccessMessage('')
  }, [])

  const parseJsonText = useCallback(() => {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (!isRecord(parsed)) {
        setError({ title: t('errors.jsonInvalid'), description: t('errors.jsonRootObject') })
        return null
      }

      return parsed
    }
    catch (jsonError) {
      setError({
        title: t('errors.jsonInvalid'),
        description: jsonError instanceof Error ? jsonError.message : String(jsonError),
      })
      return null
    }
  }, [jsonText, t])

  const handleEditModeChange = useCallback((value: string) => {
    if (value !== 'visual' && value !== 'json')
      return

    if (value === 'visual' && editMode === 'json') {
      const parsedConfig = parseJsonText()
      if (!parsedConfig)
        return
      setConfig(parsedConfig)
      setJsonText(formatJsonConfig(parsedConfig))
    }

    if (value === 'json' && config)
      setJsonText(formatJsonConfig(config))

    setVisualFocusRequest(null)
    setJsonFocusRequest(null)
    setHighlightedVisualPathKey('')
    setHighlightedJsonPathKey('')
    setError(null)
    setSuccessMessage('')
    setEditMode(value)
  }, [config, editMode, parseJsonText])

  const handleNavigateToJson = useCallback((path: ConfigPath) => {
    if (config)
      setJsonText(formatJsonConfig(config))

    focusRequestIdRef.current += 1
    setJsonFocusRequest({ id: focusRequestIdRef.current, path: [...path] })
    setHighlightedJsonPathKey(joinPath(path))
    clearJsonHighlightLater()
    setError(null)
    setSuccessMessage('')
    setEditMode('json')
  }, [clearJsonHighlightLater, config])

  const handleNavigateToVisual = useCallback((path: ConfigPath) => {
    const nextConfig = editMode === 'json' ? parseJsonText() : config
    if (!nextConfig)
      return

    if (editMode === 'json') {
      setConfig(nextConfig)
      setJsonText(formatJsonConfig(nextConfig))
    }

    // 页面版一次只渲染一个分区，所以回可视化之前得先切到这个字段所在的分区，不然滚过去也是空的
    const targetSections = buildConfigSections(nextConfig, originalConfig, serviceTarget, t)
    const targetSection = targetSections.find(section =>
      section.paths.some(sectionPath => sectionPath.every((segment, index) => segment === path[index])),
    )
    if (targetSection)
      handleSectionSelect(targetSection.id)

    focusRequestIdRef.current += 1
    setVisualFocusRequest({ id: focusRequestIdRef.current, path: [...path] })
    setHighlightedVisualPathKey(joinPath(path))
    setJsonFocusRequest(null)
    setHighlightedJsonPathKey('')
    clearVisualHighlightLater()
    setError(null)
    setSuccessMessage('')
    setEditMode('visual')
  }, [clearVisualHighlightLater, config, editMode, handleSectionSelect, originalConfig, parseJsonText, serviceTarget, t])

  const handleJsonTextChange = useCallback((value: string) => {
    setJsonText(value)
    setError(null)
    setSuccessMessage('')
  }, [])

  const handleJsonFocusRequestHandled = useCallback((requestId: number) => {
    setJsonFocusRequest(current => current?.id === requestId ? null : current)
  }, [])

  const handleVisualFocusRequestHandled = useCallback((requestId: number) => {
    setVisualFocusRequest(current => current?.id === requestId ? null : current)
  }, [])

  const getEditableConfig = useCallback(() => {
    if (editMode === 'visual')
      return config

    const parsedConfig = parseJsonText()
    if (parsedConfig)
      setConfig(parsedConfig)
    return parsedConfig
  }, [config, editMode, parseJsonText])

  const validateConfig = useCallback(async (action: LoadingAction = 'validate', configOverride?: Record<string, unknown>) => {
    const editableConfig = configOverride ?? getEditableConfig()
    if (!editableConfig)
      return false
    const submittableConfig = stripInsertedRelayPlaceholder(editableConfig, insertedRelayPath, serviceTarget)

    setLoadingAction(action)
    setError(null)
    setSuccessMessage('')

    try {
      const response = await validateConfigEditorConfigApi({ config: submittableConfig }, serviceTarget, true)
      if (!response || response.code !== 0) {
        reportFailure('errors.validateFailed', readApiFailure(response))
        return false
      }
      if (action === 'validate') {
        setSuccessMessage(t('messages.validateSuccess'))
        toast.success(t('messages.validateSuccess'))
      }
      return true
    }
    catch (validateError) {
      reportFailure('errors.validateFailed', readThrownFailure(validateError))
      return false
    }
    finally {
      if (action === 'validate')
        setLoadingAction(null)
    }
  }, [getEditableConfig, insertedRelayPath, reportFailure, serviceTarget, t])

  const saveConfig = useCallback(async (action: LoadingAction = 'save') => {
    const editableConfig = getEditableConfig()
    if (!editableConfig)
      return false
    const submittableConfig = stripInsertedRelayPlaceholder(editableConfig, insertedRelayPath, serviceTarget)

    setLoadingAction(action)
    setError(null)
    setSuccessMessage('')

    try {
      const valid = await validateConfig(action, editableConfig)
      if (!valid)
        return false

      const response = await saveConfigEditorConfigApi({ config: submittableConfig }, serviceTarget, true)
      if (!response || response.code !== 0) {
        // 这里是最重要的一条：保存失败就把服务端的原话摆出来，不要糊成「稍后重试」
        reportFailure('errors.saveFailed', readApiFailure(response))
        return false
      }

      const normalizedConfig = ensureRelayConfig(submittableConfig, serviceTarget)
      setConfig(normalizedConfig.config)
      setOriginalConfig(normalizedConfig.config)
      setJsonText(formatJsonConfig(normalizedConfig.config))
      setInsertedRelayPath(normalizedConfig.insertedRelayPath)
      if (action === 'save') {
        setSuccessMessage(t('messages.saveSuccess'))
        toast.success(t('messages.saveSuccess'))
      }
      return true
    }
    catch (saveError) {
      reportFailure('errors.saveFailed', readThrownFailure(saveError))
      return false
    }
    finally {
      if (action === 'save')
        setLoadingAction(null)
    }
  }, [getEditableConfig, insertedRelayPath, reportFailure, serviceTarget, t, validateConfig])

  const waitForHealth = useCallback(async () => {
    setServiceStatus('restarting')
    setHealthAttempts(0)

    for (let attempt = 1; attempt <= healthCheckMaxAttempts; attempt += 1) {
      setHealthAttempts(attempt)
      await new Promise(resolve => window.setTimeout(resolve, healthCheckIntervalMs))
      const healthy = await checkConfigEditorConfigReadyApi(serviceTarget)
      if (healthy) {
        setServiceStatus('running')
        setSuccessMessage(t('messages.restartSuccess'))
        toast.success(t('messages.restartSuccess'))
        return true
      }
    }

    setServiceStatus('failed')
    setError({ title: t('errors.healthTimeout'), description: t('errors.healthTimeoutDescription') })
    toast.error(t('errors.healthTimeout'))
    return false
  }, [serviceTarget, t])

  const restartService = useCallback(async (action: LoadingAction = 'restart') => {
    setLoadingAction(action)
    setError(null)
    setSuccessMessage('')

    try {
      const response = await restartConfigEditorServiceApi(serviceTarget, true)
      if (!response || response.code !== 0) {
        setServiceStatus('failed')
        reportFailure('errors.restartFailed', readApiFailure(response))
        return
      }

      await waitForHealth()
    }
    catch (restartError) {
      setServiceStatus('failed')
      reportFailure('errors.restartFailed', readThrownFailure(restartError))
    }
    finally {
      setLoadingAction(null)
    }
  }, [reportFailure, serviceTarget, waitForHealth])

  const handleSaveAndRestart = useCallback(async () => {
    const saved = await saveConfig('saveRestart')
    if (!saved) {
      setLoadingAction(null)
      return
    }
    await restartService('saveRestart')
  }, [restartService, saveConfig])

  const status: ConfigEditorStatus = {
    service: serviceStatus,
    format,
    dirty,
  }
  const isReloading = loadingAction === 'load'
  const isValidating = loadingAction === 'validate'
  const isSaving = loadingAction === 'save'
  const isRestarting = loadingAction === 'saveRestart' || loadingAction === 'restart'
  const isInitialLoading = isReloading && !config

  const renderVisualContent = () => {
    if (isInitialLoading)
      return <LoadingSkeleton />

    if (!config || !activeSection) {
      return (
        <ConfigSectionShell title={t('errors.loadFailed')} desc={error?.description}>
          <ConfigCard>
            <Button type="button" variant="outline" disabled={disabled} onClick={loadConfig}>
              <RefreshCw className="size-4" />
              {t('actions.reload')}
            </Button>
          </ConfigCard>
        </ConfigSectionShell>
      )
    }

    return (
      <ConfigFormPanel
        section={activeSection}
        sections={sections}
        config={config}
        originalConfig={originalConfig}
        disabled={disabled}
        focusRequest={visualFocusRequest}
        highlightedPathKey={highlightedVisualPathKey}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSectionSelect={handleSectionSelect}
        onFocusRequestHandled={handleVisualFocusRequestHandled}
        onValueChange={handleValueChange}
        onNavigateToJson={handleNavigateToJson}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <FileSliders className="size-6 shrink-0 text-muted-foreground" />
          {t('page.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t('page.subtitle')}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {dirty && (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 font-normal text-warning-text">
              {t('status.dirty')}
            </Badge>
          )}
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={serviceTarget} onValueChange={handleServiceTargetChange}>
          <TabsList className="h-9">
            <TabsTrigger value={ConfigEditorServiceTarget.Server} disabled={serverServiceDisabled} className="gap-1.5 text-xs">
              <Server className="h-3.5 w-3.5" />
              {t('services.server')}
            </TabsTrigger>
            <TabsTrigger value={ConfigEditorServiceTarget.Ai} disabled={aiServiceDisabled} className="gap-1.5 text-xs">
              <Bot className="h-3.5 w-3.5" />
              {t('services.ai')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {editMode === 'json' && (
            <span className="hidden text-xs text-muted-foreground sm:inline">{t('messages.jsonHint')}</span>
          )}
          <Tabs value={editMode} onValueChange={handleEditModeChange}>
            <TabsList className="h-9" aria-label={t('tabs.modeSwitch')}>
              <TabsTrigger value="visual" className="gap-1.5 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('tabs.visual')}
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-1.5 text-xs">
                <Braces className="h-3.5 w-3.5" />
                {t('tabs.json')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-5">
          <AlertCircle className="h-4 w-4" />
          <div className="min-w-0">
            <AlertTitle>{error.title}</AlertTitle>
            {error.description && (
              <AlertDescription className="whitespace-pre-wrap break-words">
                {error.description}
              </AlertDescription>
            )}
          </div>
        </Alert>
      )}

      {editMode === 'visual'
        ? (
            <div className="mt-7 flex flex-col gap-7 md:mt-8 md:flex-row md:gap-10">
              {sections.length > 0 && (
                <ConfigSectionNav
                  sections={sections}
                  activeSectionId={activeSection?.id ?? ''}
                  disabled={disabled}
                  onSectionSelect={handleSectionSelect}
                />
              )}
              <div className="min-w-0 flex-1">{renderVisualContent()}</div>
            </div>
          )
        : (
            <div className="mt-7 md:mt-8">
              <ConfigJsonPanel
                jsonText={jsonText}
                disabled={disabled}
                hasConfig={!!config}
                focusRequest={jsonFocusRequest}
                highlightedPathKey={highlightedJsonPathKey}
                initialScrollTop={jsonScrollTop}
                onFocusRequestHandled={handleJsonFocusRequestHandled}
                onJsonTextChange={handleJsonTextChange}
                onScrollTopChange={setJsonScrollTop}
                onNavigateToVisual={handleNavigateToVisual}
              />
            </div>
          )}

      {/*
        操作条：桌面端吸在底部，配置很长时也能随手保存。
        手机上不吸底——四个按钮会占掉一屏的五分之一，还糊在内容上；
        窄屏就按设置页的习惯，放在内容末尾跟着滚。
      */}
      <div className="mt-8 flex flex-col gap-3 border-t border-border bg-background/95 py-3 md:sticky md:bottom-0 md:z-10 md:flex-row md:items-center md:justify-between md:backdrop-blur md:supports-[backdrop-filter]:bg-background/80">
        <div className="min-w-0 flex-1 text-sm">
          {serviceStatus === 'restarting'
            ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {t('messages.healthChecking', { current: healthAttempts, total: healthCheckMaxAttempts })}
                </span>
              )
            : successMessage
              ? (
                  <span className="flex items-center gap-2 text-success-text">
                    <CheckCircle2 className="h-4 w-4" />
                    {successMessage}
                  </span>
                )
              : (
                  <span className={cn('text-muted-foreground', dirty && 'text-warning-text')}>
                    {dirty ? t('messages.dirtyHint') : t('messages.cleanHint')}
                  </span>
                )}
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button type="button" variant="outline" disabled={disabled} onClick={loadConfig}>
            {isReloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('actions.reload')}
          </Button>
          <Button type="button" variant="outline" disabled={disabled || !config} onClick={() => validateConfig()}>
            {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t('actions.validate')}
          </Button>
          <Button type="button" variant="outline" disabled={disabled || !config || !dirty} onClick={() => saveConfig()}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('actions.save')}
          </Button>
          <Button type="button" disabled={disabled || !config} onClick={dirty ? handleSaveAndRestart : () => restartService()}>
            {isRestarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {dirty ? t('actions.saveAndRestart') : t('actions.restart')}
          </Button>
        </div>
      </div>
    </div>
  )
}
