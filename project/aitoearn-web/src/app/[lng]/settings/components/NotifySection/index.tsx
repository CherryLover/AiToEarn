/**
 * 通知分区 - Bark 推送配置与通知规则
 *
 * 四件事写在最前面：
 *
 * 1. **Bark 地址和 key 绝不能进日志。** 这个文件里没有一处 console 打这两个值，
 *    出错只打错误码。加代码时也别顺手 `console.log(values)`——整个表单里就带着它们。
 * 2. **key 读回来是掩码，不回填输入框。** 密钥输入框初始永远是空的，掩码只放在说明文字里。
 *    用户不动它，提交的就是空串，服务端理解为「不改」。绝不能把掩码提交上去存成真 key。
 * 3. **规则是列表，不是一个布尔值。** 现在只有「AI 生成素材结束后通知」一条，
 *    但渲染走 `NOTIFY_RULE_ORDER` 数组，以后加规则只加枚举值，这个组件不用改。
 * 4. **字段名一律照抄服务端 VO**（`barkKeyMask` / `barkKeyConfigured` / `envFallbackAvailable`）。
 *    这里是手写声明，名字对不上编译一个字都不报，只会在用户眼前表现成掩码不显示、
 *    改个分组都被要求重输密钥。改名前先看 `settings-notify.vo.ts`。
 */

'use client'

import type { NotifyChannel } from '../../settings.utils'
import type { NotifyRule, NotifySetting } from '@/api/settings/notify.types'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Info, RefreshCw, Send, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  getNotifySettingApi,
  saveNotifySettingApi,
  testNotifySettingApi,
} from '@/api/settings/notify.api'
import {
  NOTIFY_BARK_BASE_URL_MAX_LENGTH,
  NOTIFY_BARK_KEY_MAX_LENGTH,
  NOTIFY_GROUP_DEFAULT,
  NOTIFY_GROUP_MAX_LENGTH,
  NOTIFY_RULE_ORDER,
} from '@/api/settings/notify.constants'
import { NotifyRuleType } from '@/api/settings/notify.types'
import { useTransClient } from '@/app/i18n/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/utils/ui/toast'
import {
  getNotifyErrorKey,
  getNotifyTestFailKey,
  resolveNotifyChannel,
  validateBarkBaseUrl,
  validateNotifyGroup,
} from '../../settings.utils'
import { SettingsCard, SettingsSection } from '../SettingsSection'

interface NotifyFormData {
  enabled: boolean
  barkBaseUrl: string
  /** 永远从空串开始：空串 = 不改已存的 key */
  barkKey: string
  group: string
  rules: NotifyRule[]
}

/** 测试结果只在页面上展示，不进任何持久化 */
interface TestState {
  success: boolean
  message: string
}

/**
 * 把服务端返回的规则补全成完整列表：
 * 服务端没返回的规则类型默认开着，不然用户开了总开关却什么都收不到。
 */
function toFormRules(rules?: NotifyRule[]): NotifyRule[] {
  return NOTIFY_RULE_ORDER.map((type) => {
    const matched = rules?.find(rule => rule.type === type)
    return { type, enabled: matched ? matched.enabled : true }
  })
}

function toFormValues(setting?: NotifySetting | null): NotifyFormData {
  return {
    // 从没保存过的用户，服务端回的 enabled 只是个默认值，不是他自己关的。
    // 这时候服务器要是配了默认通道，他其实**正在收通知**——开关就得显示成开着，
    // 不然界面一边说「关着，什么都不推」，一边他手机上还在响。
    enabled: setting?.updatedAt == null
      ? Boolean(setting?.envFallbackAvailable)
      : setting.enabled,
    barkBaseUrl: setting?.barkBaseUrl ?? '',
    barkKey: '',
    group: setting?.group ?? NOTIFY_GROUP_DEFAULT,
    rules: toFormRules(setting?.rules),
  }
}

/**
 * 服务器配了默认通道时，说清楚现在到底走的哪条。
 * 只在 `envFallbackAvailable` 为真时用，所以不用管「既没默认通道又没自己填」的情况。
 */
function pickEnvNoteKey(channel: NotifyChannel): string {
  if (channel === 'user')
    return 'notify.envFallback.user'
  if (channel === 'env')
    return 'notify.envFallback.env'
  return 'notify.envFallback.off'
}

/** 测试按钮旁边那句提示。点不了的时候必须说清楚为什么点不了 */
function pickTestHintKey(
  isDirty: boolean,
  channel: NotifyChannel,
  setting?: NotifySetting | null,
): string | null {
  if (isDirty)
    return 'notify.testDirtyHint'
  if (channel === 'env')
    return 'notify.testEnvHint'
  if (channel !== 'none')
    return null
  // 存过配置又把总开关关了，和「压根没配」是两回事，提示也得是两句
  if (setting?.updatedAt && !setting.enabled)
    return 'notify.testOffHint'
  return 'notify.testEmptyHint'
}

export function NotifySection() {
  const { t } = useTransClient('settings')

  const [setting, setSetting] = useState<NotifySetting | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testState, setTestState] = useState<TestState | null>(null)

  const schema = useMemo(
    () =>
      z
        .object({
          enabled: z.boolean(),
          barkBaseUrl: z.string().max(NOTIFY_BARK_BASE_URL_MAX_LENGTH, t('notify.urlError.tooLong')),
          barkKey: z.string().max(NOTIFY_BARK_KEY_MAX_LENGTH, t('notify.keyError.tooLong')),
          group: z.string().max(NOTIFY_GROUP_MAX_LENGTH, t('notify.groupError.tooLong')),
          rules: z.array(
            z.object({
              type: z.nativeEnum(NotifyRuleType),
              enabled: z.boolean(),
            }),
          ),
        })
        .superRefine((values, ctx) => {
          const url = values.barkBaseUrl.trim()

          // 地址可以留空：留空表示不用自己的通道，服务器配了默认通道就走默认通道
          // （contract-settings 第五节）。填了就必须合法，免得存进去一个坏值。
          if (url) {
            const urlErrorKey = validateBarkBaseUrl(url)
            if (urlErrorKey) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['barkBaseUrl'],
                message: t(urlErrorKey),
              })
            }
          }

          const groupErrorKey = validateNotifyGroup(values.group)
          if (groupErrorKey) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['group'],
              message: t(groupErrorKey),
            })
          }

          // 填了地址就得有 key（服务端 20603 就是这条），前端先拦一次少跑一趟
          if (url && !setting?.barkKeyConfigured && !values.barkKey.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['barkKey'],
              message: t('notify.keyError.required'),
            })
          }
        }),
    [t, setting?.barkKeyConfigured],
  )

  const form = useForm<NotifyFormData>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(null),
    mode: 'onSubmit',
  })

  const { reset } = form

  const loadSetting = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await getNotifySettingApi()
      if (res && res.code === 0 && res.data) {
        setSetting(res.data)
        reset(toFormValues(res.data))
        setLoadFailed(false)
        return
      }
      setLoadFailed(true)
    }
    catch (error) {
      // 只记一行，不要把 error 里可能带着的请求体打出来
      console.error('Load notify setting failed')
      void error
      setLoadFailed(true)
    }
    finally {
      setIsLoading(false)
    }
  }, [reset])

  useEffect(() => {
    loadSetting()
  }, [loadSetting])

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await saveNotifySettingApi({
        enabled: values.enabled,
        barkBaseUrl: values.barkBaseUrl.trim(),
        // 空串表示不改；只有用户真的输入了才会带上新值
        barkKey: values.barkKey.trim(),
        group: values.group.trim() || NOTIFY_GROUP_DEFAULT,
        rules: values.rules,
      })

      if (res && res.code === 0 && res.data) {
        setSetting(res.data)
        reset(toFormValues(res.data))
        setTestState(null)
        toast.success(t('notify.saveSuccess'))
        return
      }

      const errorKey = getNotifyErrorKey(res?.code)
      toast.error(errorKey ? t(errorKey) : res?.message || t('notify.error.saveFailed'))
    }
    catch (error) {
      console.error('Save notify setting failed')
      void error
      toast.error(t('notify.error.saveFailed'))
    }
  })

  const handleTest = async () => {
    setIsTesting(true)
    setTestState(null)
    try {
      const res = await testNotifySettingApi()

      if (res && res.code === 0 && res.data?.success) {
        setTestState({ success: true, message: t('notify.testSuccessDesc') })
        return
      }

      // 失败原因照服务端的原因码逐个翻，别一律落到「过一会儿再试」
      if (res && res.code === 0 && res.data) {
        setTestState({ success: false, message: t(getNotifyTestFailKey(res.data.failure)) })
        return
      }

      const errorKey = getNotifyErrorKey(res?.code)
      setTestState({
        success: false,
        message: errorKey ? t(errorKey) : res?.message || t('notify.testFail.unknown'),
      })
    }
    catch (error) {
      console.error('Send test notification failed')
      void error
      setTestState({ success: false, message: t('notify.testFail.unknown') })
    }
    finally {
      setIsTesting(false)
    }
  }

  const isSaving = form.formState.isSubmitting
  const isDirty = form.formState.isDirty
  const rules = form.watch('rules')
  const enabled = form.watch('enabled')

  // 已保存的配置现在走哪条通道。测试接口用的就是已保存的那份，所以这里一律看 setting，不看表单
  const channel = resolveNotifyChannel(setting)
  // 有没保存的改动时先别让点：测的和看到的不是一回事，只会让人更糊涂
  const canTest = !isDirty && !isLoading && !loadFailed && channel !== 'none'
  const testHintKey = pickTestHintKey(isDirty, channel, setting)

  if (isLoading) {
    return (
      <SettingsSection title={t('nav.notify')} desc={t('notify.desc')}>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </SettingsSection>
    )
  }

  if (loadFailed) {
    return (
      <SettingsSection title={t('nav.notify')} desc={t('notify.desc')}>
        <SettingsCard>
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm text-muted-foreground">{t('notify.loadFailed')}</p>
            <Button variant="outline" onClick={loadSetting}>
              <RefreshCw className="size-4" />
              {t('notify.retry')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title={t('nav.notify')} desc={t('notify.desc')}>
      <Form {...form}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <SettingsCard title={t('notify.channelTitle')} desc={t('notify.channelDesc')}>
            <div className="flex flex-col gap-7">
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0 space-y-1.5">
                      <FormLabel>{t('notify.enabledLabel')}</FormLabel>
                      <FormDescription>{t('notify.enabledDesc')}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label={t('notify.enabledLabel')}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {setting?.envFallbackAvailable && (
                <Alert>
                  <Info className="size-4" />
                  <div className="min-w-0">
                    <AlertTitle>{t('notify.envFallback.title')}</AlertTitle>
                    <AlertDescription>{t(pickEnvNoteKey(channel))}</AlertDescription>
                  </div>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="barkBaseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('notify.urlLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={NOTIFY_BARK_BASE_URL_MAX_LENGTH}
                        placeholder={t('notify.urlPlaceholder')}
                        className="sm:max-w-xl"
                      />
                    </FormControl>
                    <FormDescription>{t('notify.urlDesc')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="barkKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('notify.keyLabel')}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        {...field}
                        autoComplete="new-password"
                        spellCheck={false}
                        maxLength={NOTIFY_BARK_KEY_MAX_LENGTH}
                        placeholder={
                          setting?.barkKeyConfigured
                            ? t('notify.keyPlaceholderSet')
                            : t('notify.keyPlaceholderEmpty')
                        }
                        className="sm:max-w-xl"
                      />
                    </FormControl>
                    <FormDescription>
                      {setting?.barkKeyConfigured
                        ? t('notify.keyDescSet', { masked: setting.barkKeyMask })
                        : t('notify.keyDescEmpty')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="group"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('notify.groupLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="off"
                        maxLength={NOTIFY_GROUP_MAX_LENGTH}
                        placeholder={NOTIFY_GROUP_DEFAULT}
                        className="sm:max-w-xs"
                      />
                    </FormControl>
                    <FormDescription>{t('notify.groupDesc')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </SettingsCard>

          <SettingsCard title={t('notify.rulesTitle')} desc={t('notify.rulesDesc')}>
            <ul className="flex flex-col divide-y divide-border">
              {rules.map((rule, index) => (
                <li key={rule.type} className="py-4 first:pt-0 last:pb-0">
                  <FormField
                    control={form.control}
                    name={`rules.${index}.enabled`}
                    render={({ field }) => (
                      <FormItem className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                        <div className="min-w-0 space-y-1.5">
                          <FormLabel>{t(`notify.rule.${rule.type}.title`)}</FormLabel>
                          <FormDescription>{t(`notify.rule.${rule.type}.desc`)}</FormDescription>
                        </div>
                        <FormControl>
                          {/* 总开关关掉 = 彻底不推，规则是它下面的第二层筛子，这时候调没有意义 */}
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={!enabled}
                            aria-label={t(`notify.rule.${rule.type}.title`)}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </li>
              ))}
            </ul>
            {!enabled && (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                {t('notify.rulesDisabledHint')}
              </p>
            )}
          </SettingsCard>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!isDirty || isSaving} loading={isSaving}>
              {isSaving ? t('notify.saving') : t('notify.save')}
            </Button>
            {isDirty && !isSaving && (
              <span className="text-sm text-muted-foreground">{t('form.unsaved')}</span>
            )}
          </div>
        </form>
      </Form>

      <SettingsCard title={t('notify.testTitle')} desc={t('notify.testDesc')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={!canTest || isTesting}
              loading={isTesting}
            >
              <Send className="size-4" />
              {t('notify.testAction')}
            </Button>
            {testHintKey && (
              <span className="text-sm text-muted-foreground">{t(testHintKey)}</span>
            )}
          </div>

          {testState && (
            <Alert variant={testState.success ? 'default' : 'destructive'}>
              {testState.success
                ? <CheckCircle2 className="size-4" />
                : <XCircle className="size-4" />}
              <div className="min-w-0">
                <AlertTitle>
                  {testState.success ? t('notify.testSuccess') : t('notify.testFailed')}
                </AlertTitle>
                <AlertDescription>{testState.message}</AlertDescription>
              </div>
            </Alert>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
