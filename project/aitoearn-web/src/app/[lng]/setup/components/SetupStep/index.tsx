/**
 * 引导页的一步
 *
 * 一个就绪检查项 = 一步。每步说清三件事：**这是什么、不配会怎样、去哪拿**，
 * 然后就地把值填了、保存、当场复检（contract-runtime-config 4.2）。
 *
 * 几条不能改掉的行为：
 *
 * 1. **密钥不回填。** 配置里存着明文 Key，但这里不把它放进输入框——
 *    只显示「已经设置过了」。留空提交 = 不改，跟设置页那条规矩一致。
 *    顺带：这个文件里没有一处 console 打 `config` 或表单值，配置对象整个带着 Key。
 * 2. **受保护的键不给填。** `assets`、`projects` 这些只能从 `.env` 改（契约 3.3），
 *    覆盖层会拒。给它渲染一个输入框，用户填完只会收到一句保存失败——
 *    不如一开始就说清楚要去服务器上改。
 * 3. **保存完必须复检。** 保存成功不等于配好了：地址填错、Key 过期，
 *    都是保存成功但探测失败。绿了才算过。
 * 4. **改完要不要重启，得说。** 只有 `agent` 一段热生效（契约 3.5）。
 *    其余保存完复检还是红的——不说清楚，用户会以为自己填错了，然后反复改同一个框。
 */

'use client'

import type { SetupStepSpec } from '../../setup.constants'
import type { ReadinessItemVo, ReadinessVo } from '@/api/system/readiness.types'
import type { RuntimeConfigVo } from '@/api/system/runtime-config.types'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  RefreshCw,
  RotateCw,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAgentModelsApi } from '@/api/system/agent-models.api'
import { ReadinessItemKey, ReadinessStatus } from '@/api/system/readiness.types'
import {
  getRuntimeConfigApi,
  restartRuntimeServiceApi,
  saveRuntimeConfigApi,
} from '@/api/system/runtime-config.api'
import { useTransClient } from '@/app/i18n/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { badgeVariants } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { SettingsCard } from '../../../settings/components/SettingsSection'
import {
  applyModelSelection,
  coerceFieldValue,
  getConfigOverrideErrorKey,
  getConfigValue,
  isInlineEditableValue,
  isKnownItemKey,
  isProtectedConfigPath,
  isSecretConfigured,
  setConfigValue,
} from '../../setup.utils'

interface SetupStepProps {
  item: ReadinessItemVo
  spec: SetupStepSpec
  /** 从 1 开始，只用来显示「第 N 步」 */
  index: number
  open: boolean
  onToggle: () => void
  skipped: boolean
  onSkip: () => void
  /**
   * 复检：交给页面去调 store 的 refresh，这样所有步骤共用同一份结果。
   * 回的是整份新结果，这一步自己从里面挑出自己那一项，好当场说「过了」还是「还是没过」。
   */
  onRecheck: () => Promise<ReadinessVo | null>
}

/** 保存后这一步自己的即时反馈，不进任何持久化 */
interface StepFeedback {
  tone: 'negative' | 'neutral'
  message: string
}

export function SetupStep({
  item,
  spec,
  index,
  open,
  onToggle,
  skipped,
  onSkip,
  onRecheck,
}: SetupStepProps) {
  const { t } = useTransClient('setup')

  const [config, setConfig] = useState<RuntimeConfigVo | null>(null)
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [configLoadFailed, setConfigLoadFailed] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isRechecking, setIsRechecking] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [feedback, setFeedback] = useState<StepFeedback | null>(null)
  /** 保存过但还没重启：只有非热生效的步骤会用到 */
  const [needsRestart, setNeedsRestart] = useState(false)
  /** 上游报上来的模型清单。空数组 = 还没拉到，「默认模型」那一格退回手填 */
  const [upstreamModels, setUpstreamModels] = useState<string[]>([])
  const [modelsDetail, setModelsDetail] = useState<string | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  /** 保存时顺带对齐掉的角色模型键路径。偷偷改用户配置是不行的，改了就得说 */
  const [alignedNote, setAlignedNote] = useState<string | null>(null)

  const isOk = item.status === ReadinessStatus.Ok
  const known = isKnownItemKey(item.key)
  const copyKey = known ? item.key : 'unknown'
  const copyVars = { key: item.key, path: item.configPath ?? '' }

  const hasEditableSpec = spec.fields.length > 0

  const loadConfig = useCallback(async () => {
    setIsLoadingConfig(true)
    setConfigLoadFailed(false)
    try {
      const res = await getRuntimeConfigApi(spec.target)
      if (res && res.code === 0 && res.data) {
        setConfig(res.data)
        return
      }
      setConfigLoadFailed(true)
    }
    catch {
      // 只记状态，不打日志：配置对象里带着 Key
      setConfigLoadFailed(true)
    }
    finally {
      setIsLoadingConfig(false)
    }
  }, [spec.target])

  // 展开了才去读配置：一份配置几千行，没人展开的步骤没必要拉
  useEffect(() => {
    if (open && hasEditableSpec && !config && !isLoadingConfig && !configLoadFailed)
      void loadConfig()
  }, [open, hasEditableSpec, config, isLoadingConfig, configLoadFailed, loadConfig])

  /** 这一步里有没有要做成下拉的模型字段 */
  const hasModelSelect = useMemo(
    () => spec.fields.some(field => !!field.modelSelect),
    [spec.fields],
  )

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true)
    try {
      const res = await getAgentModelsApi()
      if (res && res.code === 0 && res.data) {
        setUpstreamModels(res.data.models)
        setModelsDetail(res.data.detail)
        return
      }
      setUpstreamModels([])
      setModelsDetail(res?.message || null)
    }
    catch {
      // 不打日志：这条链路上的失败信息可能带着上游的返回体
      setUpstreamModels([])
      setModelsDetail(null)
    }
    finally {
      setIsLoadingModels(false)
    }
  }, [])

  // 展开时拉一次清单。拉不到不影响这一步能不能用：那一格会退回手填输入框
  useEffect(() => {
    if (open && hasModelSelect)
      void loadModels()
  }, [open, hasModelSelect, loadModels])

  /** 每个字段现在的样子：值、是不是受保护、能不能用一个输入框填 */
  const fieldStates = useMemo(() => {
    if (!config)
      return []

    return spec.fields.map((field) => {
      const current = getConfigValue(config.config, field.path)
      return {
        field,
        current,
        protectedHere: isProtectedConfigPath(field.path, config.protectedPaths),
        inlineEditable: isInlineEditableValue(current),
        secretConfigured: field.secret ? isSecretConfigured(current) : false,
      }
    })
  }, [config, spec.fields])

  const editableStates = fieldStates.filter(state => !state.protectedHere && state.inlineEditable)
  const blockedStates = fieldStates.filter(state => state.protectedHere || !state.inlineEditable)

  /** 这一步压根没有能在网页上填的东西 */
  const manualOnly = !hasEditableSpec || (!!config && editableStates.length === 0)

  const readFieldValue = (path: string, fallback: unknown) => {
    if (path in values)
      return values[path]
    return fallback == null ? '' : String(fallback)
  }

  const handleChange = (path: string, next: string) => {
    setValues(previous => ({ ...previous, [path]: next }))
    setErrors((previous) => {
      if (!previous[path])
        return previous
      const { [path]: _removed, ...rest } = previous
      return rest
    })
    setFeedback(null)
  }

  const handleSave = async () => {
    if (!config)
      return

    // 校验：必填项要么已经有值，要么这次填了。密钥已经设置过就不再逼人重输
    const nextErrors: Record<string, string> = {}
    for (const state of editableStates) {
      if (!state.field.required)
        continue

      const typed = (values[state.field.path] ?? '').trim()
      const alreadySet = state.field.secret
        ? state.secretConfigured
        : state.current != null && String(state.current).trim() !== ''

      if (!typed && !alreadySet)
        nextErrors[state.field.path] = t('form.required')
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSaving(true)
    setFeedback(null)
    try {
      // 整份提交，差异由服务端算（契约 3.4）。自己算 diff 会把没动过的字段冻成覆盖值
      let nextConfig = config.config
      /** 选模型时顺带对齐掉的角色模型，保存完要如实说一声 */
      const alignedPaths: string[] = []
      for (const state of editableStates) {
        const raw = values[state.field.path]
        if (raw == null)
          continue

        const typed = raw.trim()
        // 密钥留空 = 不改，绝不能把空串写回去，那等于把 Key 删了
        if (state.field.secret && !typed)
          continue

        // 选模型要连着改清单和另外两个角色模型，只写这一格保存会被整份拒掉
        if (state.field.modelSelect && typed) {
          const result = applyModelSelection(
            nextConfig,
            state.field.path,
            state.field.modelSelect,
            typed,
            upstreamModels,
          )
          nextConfig = result.config
          alignedPaths.push(...result.aligned)
          continue
        }

        nextConfig = setConfigValue(
          nextConfig,
          state.field.path,
          coerceFieldValue(typed, state.current),
        )
      }

      const res = await saveRuntimeConfigApi(spec.target, nextConfig)
      if (!res || res.code !== 0) {
        const errorKey = getConfigOverrideErrorKey(res?.code)
        // 服务端的真实原因比「稍后重试」有用，命不中本地文案就原样显示
        setFeedback({
          tone: 'negative',
          message: errorKey ? t(errorKey) : res?.message || t('save.error.failed'),
        })
        return
      }

      toast.success(t('save.success'))
      setValues({})
      setNeedsRestart(!spec.hotReload)
      // 重新读一遍：保存后覆盖层里的值才是下次编辑的基准
      await loadConfig()
      // 对齐那句单独渲染，不占 feedback：复检结果（过了没有）比它重要得多，不能被顶掉
      setAlignedNote(alignedPaths.length > 0 ? alignedPaths.join('、') : null)
      await runRecheck(spec.hotReload ? null : t('save.restartHint'))
    }
    catch {
      setFeedback({ tone: 'negative', message: t('save.error.failed') })
    }
    finally {
      setIsSaving(false)
    }
  }

  /**
   * 复检这一项。
   * `pendingHint` 是保存之后那句「还要重启才生效」——没它的话，
   * 用户会看到「保存成功」紧接着「还是没通过」，然后开始怀疑自己填错了。
   */
  const runRecheck = async (pendingHint: string | null = null) => {
    let latest: ReadinessVo | null = null
    setIsRechecking(true)
    try {
      latest = await onRecheck()
    }
    finally {
      setIsRechecking(false)
    }

    // 保存之后还要重启的那种，先把「为什么现在还是红的」说清楚，
    // 不然用户会以为自己填错了，然后反复改同一个框
    if (pendingHint) {
      setFeedback({ tone: 'neutral', message: pendingHint })
      return
    }

    const refreshed = latest?.items.find(candidate => candidate.key === item.key)
    if (!refreshed) {
      setFeedback(null)
      return
    }

    if (refreshed.status === ReadinessStatus.Ok) {
      setFeedback({ tone: 'neutral', message: t('recheck.passed') })
      return
    }

    setFeedback({
      tone: 'negative',
      message: refreshed.detail ? t('recheck.failed') : t('recheck.failedNoDetail'),
    })
  }

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      const res = await restartRuntimeServiceApi(spec.target)
      if (res && res.code === 0) {
        setNeedsRestart(false)
        setFeedback({ tone: 'neutral', message: t('restart.success') })
        return
      }
      setFeedback({ tone: 'negative', message: res?.message || t('restart.failed') })
    }
    catch {
      setFeedback({ tone: 'negative', message: t('restart.failed') })
    }
    finally {
      setIsRestarting(false)
    }
  }

  const statusLabel = skipped
    ? t('status.skipped')
    : isOk
      ? t('status.ok')
      : item.status === ReadinessStatus.Error
        ? t('status.error')
        : t('status.missing')

  const title = known ? t(`item.${item.key}.title`) : t('item.unknown.title', copyVars)

  return (
    <SettingsCard className={cn(isOk && 'border-success/40')}>
      <Collapsible open={open} onOpenChange={onToggle}>
        {/*
          整行就是展开/收起的按钮。不给它 aria-label：那会把可访问名字换成「展开」，
          标题和状态反而读不出来。名字由行内文字给，开合状态由 aria-expanded 给。
        */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-start gap-3 text-left"
        >
          <span
            className={cn(
              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
              isOk
                ? 'bg-success text-success-foreground'
                : skipped
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-warning text-warning-foreground',
            )}
          >
            {isOk ? <Check className="size-3.5" /> : skipped ? <CircleDashed className="size-3.5" /> : index}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-foreground">{title}</span>
              {/* 徽章用 `badgeVariants` 套在 span 上：`Badge` 渲染的是 div，
                  而这一整行是个 button，button 里不该出现 div */}
              <span
                className={cn(
                  badgeVariants({ variant: isOk ? 'secondary' : 'outline' }),
                  'font-normal',
                )}
              >
                {statusLabel}
              </span>
              {!item.required && (
                <span
                  className={cn(
                    badgeVariants({ variant: 'outline' }),
                    'font-normal text-muted-foreground',
                  )}
                >
                  {t('status.optional')}
                </span>
              )}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t('step.label', { index })}
            </span>
          </span>

          <ChevronDown
            className={cn(
              'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>

        <CollapsibleContent>
          <div className="mt-5 flex flex-col gap-6 border-t border-border pt-5">
            <dl className="flex flex-col gap-4">
              {(['what', 'impact', 'where'] as const).map(part => (
                <div key={part} className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`step.${part}`)}
                  </dt>
                  <dd className="text-sm leading-relaxed text-foreground">
                    {known ? t(`item.${copyKey}.${part}`) : t(`item.unknown.${part}`, copyVars)}
                  </dd>
                </div>
              ))}
            </dl>

            {/* 服务端给的失败原因是原文、不做 i18n，照原样显示，别包装 */}
            {!isOk && item.detail && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <div className="min-w-0">
                  <AlertTitle>{t('step.detail')}</AlertTitle>
                  <AlertDescription className="break-words">{item.detail}</AlertDescription>
                </div>
              </Alert>
            )}

            {isLoadingConfig && <Skeleton className="h-28 w-full rounded-lg" />}

            {configLoadFailed && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <div className="min-w-0">
                  <AlertTitle>{t('save.error.failed')}</AlertTitle>
                  <AlertDescription>{t('save.error.loadConfig')}</AlertDescription>
                </div>
              </Alert>
            )}

            {editableStates.length > 0 && (
              <div className="flex flex-col gap-7">
                {editableStates.map(({ field, current, secretConfigured }) => {
                  const inputId = `setup-${item.key}-${field.path.replace(/\./g, '-')}`
                  const labelKey = `field.${field.path}.label`
                  const descKey = `field.${field.path}.desc`
                  const placeholderKey = `field.${field.path}.placeholder`
                  const label = t(labelKey)
                  const desc = t(descKey)
                  const placeholder = t(placeholderKey)
                  const error = errors[field.path]

                  return (
                    <div key={field.path} className="flex flex-col gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={inputId}>
                          {label === labelKey ? t('field.generic.label', { path: field.path }) : label}
                        </Label>
                        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                          {desc === descKey
                            ? t('field.generic.desc', { path: field.path })
                            : desc}
                          {field.secret && (
                            <>
                              {' '}
                              {secretConfigured ? t('secret.configured') : t('secret.empty')}
                            </>
                          )}
                        </p>
                      </div>

                      {field.modelSelect
                        ? (
                            <div className="flex flex-col gap-2 sm:max-w-xl">
                              {/* 拉到清单才给下拉。拉不到就退回手填——上游不支持列模型接口的情况是存在的，
                                  这一格不能因此变成死路 */}
                              {upstreamModels.length > 0
                                ? (
                                    <SearchableSelect
                                      options={upstreamModels.map(name => ({ value: name, label: name }))}
                                      value={readFieldValue(field.path, current)}
                                      onValueChange={next => handleChange(field.path, next)}
                                      placeholder={t('model.placeholder')}
                                      searchPlaceholder={t('model.search')}
                                      emptyText={t('model.noMatch')}
                                      loading={isLoadingModels}
                                      triggerClassName="h-9"
                                    />
                                  )
                                : (
                                    <Input
                                      id={inputId}
                                      value={readFieldValue(field.path, current)}
                                      onChange={event => handleChange(field.path, event.target.value)}
                                      autoComplete="off"
                                      spellCheck={false}
                                      placeholder={placeholder === placeholderKey ? undefined : placeholder}
                                      aria-invalid={!!error}
                                    />
                                  )}

                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void loadModels()}
                                  disabled={isLoadingModels}
                                  loading={isLoadingModels}
                                >
                                  <RefreshCw className="size-4" />
                                  {t('model.reload')}
                                </Button>
                                <span className="text-sm text-muted-foreground">
                                  {upstreamModels.length > 0
                                    ? t('model.loaded', { count: upstreamModels.length })
                                    : t('model.manual')}
                                </span>
                              </div>

                              {/* 拉不到的原因要显示出来：地址少一层、Key 过期，都在这句里 */}
                              {upstreamModels.length === 0 && modelsDetail && (
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                  {modelsDetail}
                                </p>
                              )}
                            </div>
                          )
                        : field.secret
                          ? (
                              <PasswordInput
                                id={inputId}
                                value={values[field.path] ?? ''}
                                onChange={event => handleChange(field.path, event.target.value)}
                                autoComplete="new-password"
                                spellCheck={false}
                                placeholder={
                                  secretConfigured
                                    ? t('secret.placeholderSet')
                                    : t('secret.placeholderEmpty')
                                }
                                className="sm:max-w-xl"
                                aria-invalid={!!error}
                              />
                            )
                          : (
                              <Input
                                id={inputId}
                                value={readFieldValue(field.path, current)}
                                onChange={event => handleChange(field.path, event.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={placeholder === placeholderKey ? undefined : placeholder}
                                className="sm:max-w-xl"
                                aria-invalid={!!error}
                              />
                            )}

                      {/* 校验错误显示在字段下面，不弹窗 */}
                      {error && <p className="text-sm text-destructive">{error}</p>}

                      {/* 顺带对齐了别的角色模型就说一声，不偷偷改 */}
                      {field.modelSelect && alignedNote && (
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {t('model.aligned', { paths: alignedNote })}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 受保护的键、以及值是一份清单填不了的键，说清楚该去哪儿改 */}
            {manualOnly && !isLoadingConfig && (
              <Alert>
                <AlertTriangle className="size-4" />
                <div className="min-w-0">
                  <AlertTitle>{t('manual.title')}</AlertTitle>
                  <AlertDescription>{t('manual.desc')}</AlertDescription>
                </div>
              </Alert>
            )}

            {blockedStates.length > 0 && !manualOnly && (
              <Alert>
                <AlertTriangle className="size-4" />
                <div className="min-w-0">
                  <AlertTitle>{t('notEditable.title')}</AlertTitle>
                  <AlertDescription>{t('notEditable.desc')}</AlertDescription>
                </div>
              </Alert>
            )}

            {feedback && (
              <Alert variant={feedback.tone === 'negative' ? 'destructive' : 'default'}>
                <AlertTriangle className="size-4" />
                <AlertDescription className="min-w-0">{feedback.message}</AlertDescription>
              </Alert>
            )}

            {spec.hotReload && editableStates.length > 0 && (
              <p className="text-sm leading-relaxed text-muted-foreground">{t('save.hotHint')}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {editableStates.length > 0 && (
                <Button type="button" onClick={handleSave} disabled={isSaving} loading={isSaving}>
                  {t('actions.save')}
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => runRecheck()}
                disabled={isRechecking}
                loading={isRechecking}
              >
                <RefreshCw className="size-4" />
                {t('actions.recheck')}
              </Button>

              {needsRestart && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRestart}
                  disabled={isRestarting}
                  loading={isRestarting}
                >
                  <RotateCw className="size-4" />
                  {t('actions.restart')}
                </Button>
              )}

              {!item.required && !isOk && (
                <Button type="button" variant="ghost" onClick={onSkip}>
                  {skipped ? t('actions.undoSkip') : t('actions.skip')}
                </Button>
              )}

              {manualOnly && (
                <Button variant="ghost" asChild>
                  <Link href="/config">
                    <ExternalLink className="size-4" />
                    {t('actions.openConfig')}
                  </Link>
                </Button>
              )}

              {item.key === ReadinessItemKey.Notify && (
                <Button variant="ghost" asChild>
                  <Link href="/settings#notify">
                    <ExternalLink className="size-4" />
                    {t('actions.openNotifySettings')}
                  </Link>
                </Button>
              )}
            </div>

            {!item.required && !isOk && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {skipped ? t('skip.done') : t('skip.hint')}
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SettingsCard>
  )
}
