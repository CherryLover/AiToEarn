/**
 * ConfigField - 配置字段递归表单控件
 *
 * 这一版只改排版：原来是两列密集网格（`grid min-h-8 gap-2 py-0.5` + 每行 `border-b`），
 * 看上去就是一张表格。现在换成设置页那套竖排字段——标签和说明堆在输入框上面，
 * 字段之间 `gap-7`，开关类是左说明右开关，和 `settings/components/NotifySection` 一字不差。
 *
 * 换排法会让页面变长（服务端配置上百个字段），所以必须同时分组，不然只是把表格拉成长条：
 *
 * - **顶层配置对象 = 一张卡**（`depth === 0`，外面套 `ConfigCard`，对象名当卡片小标题）
 * - **卡里的嵌套对象/数组 = 一段带左侧竖线的子分组**，可折叠
 * - **第三层起（`depth >= 2`）默认收起**；第二层里同级分组超过 4 个、或自己字段超过 10 个的也默认收起
 * - 对象数组的每一项是一行手风琴，默认收起
 *
 * 折叠状态各节点自己记，所以「展开全部 / 收起全部」只能靠 `expandSignal` 广播（见 types）。
 *
 * ## 运行时覆盖层
 *
 * 配置现在是两层的（契约 3.3 / 3.4），字段因此多了两种状态，都从 `ConfigOverrideContext` 读：
 *
 * - **受保护**（`protectedPaths`）：只能改 `.env` 再重新部署。**输入框直接禁用**，
 *   不让人填完再被服务端拒；说明只在受保护子树的最外层讲一遍，免得每个字段都念一句。
 * - **来自覆盖层**（`overriddenPaths`）：这个值是有人在网页上改过的，给一个「运行时」小徽标。
 *   分组上显示子树里有几个这样的值，方便一眼看出哪张卡被动过。
 */
'use client'

import type { ReactNode } from 'react'
import type { ConfigFieldProps, ConfigPath, ConfigValue } from '../../types'
import { Braces, ChevronDown, Eye, EyeOff, Lock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/utils/className'
import {
  countLeafFields,
  countModifiedLeafFields,
  getConfigFieldDescription,
  getConfigFieldLabel,
  getLastStringSegment,
  isConfigValueModified,
  isSensitiveConfigPath,
} from '../../utils/configFieldMeta'
import { createEmptyValue, isRecord, joinPath } from '../../utils/configPath'
import { useConfigOverrideMeta } from '../ConfigOverrideContext'
import { ConfigCard } from '../ConfigSection'

const selectOptions: Record<string, string[]> = {
  environment: ['development', 'production'],
}

/** 同级分组超过这个数，子分组一律默认收起——全摊开等于没分组 */
const CROWDED_SIBLING_GROUP_COUNT = 4
/** 第二层分组：字段多于这个数就默认收起 */
const GROUP_OPEN_LEAF_LIMIT = 10
/** 卡片：字段多于这个数就默认收起（分区里只有一张卡时除外，见 resolveDefaultOpen） */
const CARD_OPEN_LEAF_LIMIT = 60

/**
 * 一次性把 `fieldDescriptions` 整块拿出来。
 * 必须整块拿：那里面有 `agent.models` 这种带点的键，逐个 `t()` 查会被当成嵌套层级，永远查不到。
 */
export function useConfigFieldDescriptions(): Record<string, string> {
  const { t } = useTransClient('configManager')

  return useMemo(() => {
    const raw: unknown = t('fieldDescriptions', { returnObjects: true })
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return {}

    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  }, [t])
}

const countBadgeClassName = 'h-5 shrink-0 whitespace-nowrap px-1.5 py-0 text-[11px] font-normal leading-none'
const modifiedBadgeClassName = cn(countBadgeClassName, 'border-warning/40 bg-warning/10 text-warning-text')
/** 「运行时」标记：看得见就行，别抢戏——所以是描边加一层浅底，不是实心块 */
const overrideBadgeClassName = cn(countBadgeClassName, 'gap-1 border-primary/40 bg-primary/10 text-primary')
const protectedBadgeClassName = cn(countBadgeClassName, 'gap-1 border-border bg-muted text-muted-foreground')
/** 说明文字：和设置页 `FormDescription` 同一档，别自己另调字号 */
const descriptionClassName = 'max-w-2xl text-[0.8rem] leading-relaxed text-muted-foreground'

function shouldUseTextarea(value: string) {
  return value.includes('\n') || value.length > 96
}

function getInputId(pathKey: string) {
  return `config-field-${pathKey.replace(/[^\w-]/g, '-')}`
}

function isPathPrefix(path: ConfigPath, targetPath: ConfigPath | null) {
  if (!targetPath || path.length > targetPath.length)
    return false
  return path.every((segment, index) => segment === targetPath[index])
}

/**
 * 被「定位」过来的节点高亮一下。
 * 不用 `animate-pulse`：那是在 1 到 0.5 之间来回改透明度，文字对比度会被直接腰斩，
 * 静态的 ring + 浅底一样看得见，也不违反对比度门槛。
 */
function getPathHighlightClassName(pathKey: string, highlightedPathKey: string) {
  return pathKey === highlightedPathKey && 'bg-primary/10 ring-2 ring-primary/45'
}

/** 数一层里有几个子分组（对象或数组）。兄弟分组太多就别默认展开 */
function countGroupChildren(value: unknown) {
  if (Array.isArray(value))
    return value.filter(item => isRecord(item) || Array.isArray(item)).length

  if (isRecord(value))
    return Object.values(value).filter(item => isRecord(item) || Array.isArray(item)).length

  return 0
}

/** 分组默认展开还是收起：层级越深、兄弟越多、字段越多，越该收起 */
function resolveDefaultOpen(depth: number, leafCount: number, siblingGroupCount: number) {
  // 卡片层：一个分区只有一张卡时永远摊开，不然点进分区看到的是一张关着的卡，等于什么都没有
  if (depth === 0)
    return siblingGroupCount <= 1 || leafCount <= CARD_OPEN_LEAF_LIMIT

  // 第三层起默认收起
  if (depth >= 2)
    return false

  if (siblingGroupCount > CROWDED_SIBLING_GROUP_COUNT)
    return false

  return leafCount <= GROUP_OPEN_LEAF_LIMIT
}

function ModifiedBadge({ count }: { count?: number }) {
  const { t } = useTransClient('configManager')

  return (
    <Badge variant="outline" className={modifiedBadgeClassName}>
      {count === undefined ? t('status.modified') : count}
    </Badge>
  )
}

/**
 * 「运行时」徽标：这个值来自 `config.override.yaml`，也就是有人在网页上改过。
 * 分组上带个数，叶子上不带——一个字段就是一个值，写「运行时 1」纯属废话。
 */
function OverrideBadge({ count }: { count?: number }) {
  const { t } = useTransClient('configManager')

  return (
    <Badge variant="outline" className={overrideBadgeClassName} title={t('override.runtimeBadgeTitle')}>
      {count !== undefined && count > 1 ? t('override.runtimeBadgeCount', { count }) : t('override.runtimeBadge')}
    </Badge>
  )
}

/** 「部署配置」徽标：这一项只能从 `.env` 改，页面上是只读的 */
function ProtectedBadge() {
  const { t } = useTransClient('configManager')

  return (
    <Badge variant="outline" className={protectedBadgeClassName} title={t('override.protectedHint')}>
      <Lock className="size-3" aria-hidden />
      {t('override.protectedBadge')}
    </Badge>
  )
}

/** 受保护字段下面那句解释。只在子树最外层、或搜索结果里出现一次 */
function ProtectedHint() {
  const { t } = useTransClient('configManager')

  return <p className={descriptionClassName}>{t('override.protectedHint')}</p>
}

function PathJumpButton({ path, onNavigateToJson }: {
  path: ConfigPath
  onNavigateToJson: (path: ConfigPath) => void
}) {
  const { t } = useTransClient('configManager')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/config-item:opacity-100 focus-visible:opacity-100"
      aria-label={t('actions.goToJsonField')}
      onMouseDown={event => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        onNavigateToJson([...path])
      }}
    >
      <Braces className="size-3.5" />
    </Button>
  )
}

/**
 * 字段的标签块：来路（只有搜索结果里才有）+ 标签 + 修改/运行时/部署标记 + 说明。
 * 和设置页一样用 `space-y-1.5` 把标签和说明收在一起。
 */
function FieldLabelBlock({
  inputId,
  label,
  description,
  contextLabel,
  modified,
  overridden,
  protectedField,
  showProtectedHint,
  path,
  onNavigateToJson,
}: {
  inputId: string
  label: string
  description?: string
  contextLabel?: string
  modified: boolean
  overridden: boolean
  protectedField: boolean
  showProtectedHint: boolean
  path: ConfigPath
  onNavigateToJson: (path: ConfigPath) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      {contextLabel && (
        <p className="truncate text-xs text-muted-foreground">{contextLabel}</p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Label htmlFor={inputId} className="min-w-0 break-words text-foreground">{label}</Label>
        {modified && <ModifiedBadge />}
        {overridden && <OverrideBadge />}
        {protectedField && <ProtectedBadge />}
        <PathJumpButton path={path} onNavigateToJson={onNavigateToJson} />
      </div>
      {description && <p className={descriptionClassName}>{description}</p>}
      {showProtectedHint && <ProtectedHint />}
    </div>
  )
}

/**
 * 分组外壳：卡片（`depth === 0`）和卡片里的子分组共用一套。
 *
 * 折叠触发器只包标签那一块，右边的徽章和按钮放在触发器外面——
 * 按钮套在按钮里是非法 HTML，原来的写法就是这么套的，顺手改掉。
 */
function GroupShell({
  pathKey,
  depth,
  open,
  onOpenChange,
  label,
  description,
  contextLabel,
  trailing,
  notice,
  highlightClassName,
  children,
}: {
  pathKey: string
  depth: number
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  description?: string
  contextLabel?: string
  /** 标题右边：数量徽章、新增按钮之类 */
  trailing?: ReactNode
  /** 标题下面、折叠内容外面的一句话：收起状态也看得见，受保护分组的说明放这儿 */
  notice?: ReactNode
  highlightClassName?: string | false
  children: ReactNode
}) {
  const isCard = depth === 0

  const header = (
    <div className="group/config-item flex items-start justify-between gap-3">
      <CollapsibleTrigger
        className="group/config-node -m-1 flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150',
            !open && '-rotate-90',
          )}
          aria-hidden
        />
        <div className="min-w-0 space-y-1.5">
          {contextLabel && <p className="truncate text-xs text-muted-foreground">{contextLabel}</p>}
          <span className="block break-words text-sm font-medium text-foreground">{label}</span>
          {description && <p className={descriptionClassName}>{description}</p>}
        </div>
      </CollapsibleTrigger>
      <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
    </div>
  )

  const noticeBlock = notice ? <div className="mt-2 pl-6">{notice}</div> : null

  const body = (
    <CollapsibleContent>
      <div className={cn('mt-5', !isCard && 'border-l border-border pl-4 sm:pl-5')}>
        {children}
      </div>
    </CollapsibleContent>
  )

  if (isCard) {
    return (
      <Collapsible open={open} onOpenChange={onOpenChange} asChild>
        <ConfigCard
          data-config-path-key={pathKey}
          className={cn('scroll-mt-24', highlightClassName)}
        >
          {header}
          {noticeBlock}
          {body}
        </ConfigCard>
      </Collapsible>
    )
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      data-config-path-key={pathKey}
      className={cn('scroll-mt-24 rounded-lg', highlightClassName)}
    >
      {header}
      {noticeBlock}
      {body}
    </Collapsible>
  )
}

function PrimitiveField({
  path,
  fieldKey,
  value,
  originalValue,
  disabled,
  contextLabel,
  highlightedPathKey,
  onValueChange,
  onNavigateToJson,
}: ConfigFieldProps) {
  const { t } = useTransClient('configManager')
  const fieldDescriptions = useConfigFieldDescriptions()
  const overrideMeta = useConfigOverrideMeta()
  const [showSensitiveValue, setShowSensitiveValue] = useState(false)
  const label = getConfigFieldLabel(t, path, fieldKey)
  const description = getConfigFieldDescription(fieldDescriptions, path, fieldKey)
  const pathKey = joinPath(path)
  const inputId = getInputId(pathKey)
  const lastKey = getLastStringSegment(path, fieldKey)
  const options = selectOptions[lastKey]
  const modified = isConfigValueModified(value, originalValue)
  const sensitive = isSensitiveConfigPath(path)
  const protectedField = overrideMeta.isProtected(path)
  const overridden = overrideMeta.isOverridden(path)
  // 受保护的字段不让改：与其让人填完再被服务端拒，不如一开始就禁用
  const fieldDisabled = disabled || protectedField
  // 说明只在最外层讲一遍；搜索结果是直接跳进来的，看不到外层，所以那里也讲一遍
  const showProtectedHint = protectedField && (overrideMeta.isProtectedRoot(path) || !!contextLabel)

  const labelBlock = (
    <FieldLabelBlock
      inputId={inputId}
      label={label}
      description={description}
      contextLabel={contextLabel}
      modified={modified}
      overridden={overridden}
      protectedField={protectedField}
      showProtectedHint={showProtectedHint}
      path={path}
      onNavigateToJson={onNavigateToJson}
    />
  )

  // 布尔值照设置页的开关范式：左边标签说明，右边开关
  if (typeof value === 'boolean') {
    return (
      <div
        data-config-path-key={pathKey}
        className={cn(
          'group/config-item scroll-mt-24 rounded-lg',
          getPathHighlightClassName(pathKey, highlightedPathKey),
        )}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          {labelBlock}
          <Switch
            id={inputId}
            checked={value}
            disabled={fieldDisabled}
            aria-label={label}
            onCheckedChange={checked => onValueChange(path, checked)}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      data-config-path-key={pathKey}
      className={cn(
        'group/config-item scroll-mt-24 space-y-2 rounded-lg',
        getPathHighlightClassName(pathKey, highlightedPathKey),
      )}
    >
      {labelBlock}

      {typeof value === 'number' && (
        <NumberInput
          id={inputId}
          value={value}
          disabled={fieldDisabled}
          className="sm:max-w-xs"
          onValueChange={nextValue => onValueChange(path, nextValue ?? 0)}
        />
      )}

      {typeof value === 'string' && options && (
        <Select value={value} disabled={fieldDisabled} onValueChange={nextValue => onValueChange(path, nextValue)}>
          <SelectTrigger id={inputId} className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {typeof value === 'string' && !options && sensitive && (
        <div className="relative sm:max-w-xl">
          <Input
            id={inputId}
            value={value}
            disabled={fieldDisabled}
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            className={cn('pr-10', !showSensitiveValue && '[-webkit-text-security:disc]')}
            onChange={event => onValueChange(path, event.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2 cursor-pointer text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label={showSensitiveValue ? t('actions.hideSensitiveValue') : t('actions.showSensitiveValue')}
            onClick={() => setShowSensitiveValue(current => !current)}
          >
            {showSensitiveValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      )}

      {typeof value === 'string' && !options && !sensitive && shouldUseTextarea(value) && (
        <Textarea
          id={inputId}
          value={value}
          disabled={fieldDisabled}
          rows={3}
          className="min-h-20 max-w-3xl text-sm"
          onChange={event => onValueChange(path, event.target.value)}
        />
      )}

      {typeof value === 'string' && !options && !sensitive && !shouldUseTextarea(value) && (
        <Input
          id={inputId}
          value={value}
          disabled={fieldDisabled}
          className="sm:max-w-xl"
          onChange={event => onValueChange(path, event.target.value)}
        />
      )}

      {value == null && (
        <Input
          id={inputId}
          value=""
          disabled={fieldDisabled}
          placeholder={t('common.emptyValue')}
          className="sm:max-w-xl"
          onChange={event => onValueChange(path, event.target.value)}
        />
      )}
    </div>
  )
}

function getArrayItemDisplayValue(value: unknown) {
  if (typeof value === 'string')
    return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return ''
}

function getArrayItemTitle(item: unknown, fallback: string) {
  if (!isRecord(item)) {
    const value = getArrayItemDisplayValue(item)
    return value || fallback
  }

  const titleKeys = ['displayName', 'name', 'model', 'channel', 'id', 'key']
  for (const key of titleKeys) {
    const value = getArrayItemDisplayValue(item[key])
    if (value)
      return value
  }

  return fallback
}

function ArrayItemRemoveButton({ disabled, onRemove }: {
  disabled: boolean
  onRemove: () => void
}) {
  const { t } = useTransClient('configManager')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      className="size-7 shrink-0 cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      aria-label={t('actions.remove')}
      onMouseDown={event => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        onRemove()
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  )
}

function ArrayItemAddButton({ disabled, onAdd }: {
  disabled: boolean
  onAdd: () => void
}) {
  const { t } = useTransClient('configManager')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      className="size-7 shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
      aria-label={t('actions.addItem')}
      onMouseDown={event => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        onAdd()
      }}
    >
      <Plus className="size-4" />
    </Button>
  )
}

/** 基础类型的数组项：一行一个，`#n` + 输入框 + 删除，不做成两列表格 */
function PrimitiveArrayItem({
  parentPath,
  index,
  value,
  originalValue,
  disabled,
  highlightedPathKey,
  onValueChange,
  onNavigateToJson,
  onRemove,
}: {
  parentPath: ConfigPath
  index: number
  value: unknown
  originalValue: unknown
  disabled: boolean
  highlightedPathKey: string
  onValueChange: (path: ConfigPath, value: ConfigValue) => void
  onNavigateToJson: (path: ConfigPath) => void
  onRemove: () => void
}) {
  const { t } = useTransClient('configManager')
  const overrideMeta = useConfigOverrideMeta()
  const itemPath = [...parentPath, index]
  const pathKey = joinPath(itemPath)
  const inputId = getInputId(pathKey)
  const modified = isConfigValueModified(value, originalValue)
  const overridden = overrideMeta.isOverridden(itemPath)
  const fieldDisabled = disabled || overrideMeta.isProtected(itemPath)

  return (
    <div
      data-config-path-key={pathKey}
      className={cn(
        'group/config-item flex scroll-mt-24 items-center gap-2 rounded-lg',
        getPathHighlightClassName(pathKey, highlightedPathKey),
      )}
    >
      <Label htmlFor={inputId} className="w-9 shrink-0 font-mono text-xs text-muted-foreground">
        #
        {index + 1}
      </Label>

      <div className="min-w-0 flex-1">
        {typeof value === 'boolean' && (
          <div className="flex h-9 items-center gap-3">
            <Switch
              id={inputId}
              checked={value}
              disabled={fieldDisabled}
              onCheckedChange={checked => onValueChange(itemPath, checked)}
            />
            <span className="text-sm text-muted-foreground">
              {value ? t('common.enabled') : t('common.disabled')}
            </span>
          </div>
        )}

        {typeof value === 'number' && (
          <NumberInput
            id={inputId}
            value={value}
            disabled={fieldDisabled}
            onValueChange={nextValue => onValueChange(itemPath, nextValue ?? 0)}
          />
        )}

        {typeof value === 'string' && (
          <Input
            id={inputId}
            value={value}
            disabled={fieldDisabled}
            onChange={event => onValueChange(itemPath, event.target.value)}
          />
        )}

        {value == null && (
          <Input
            id={inputId}
            value=""
            disabled={fieldDisabled}
            placeholder={t('common.emptyValue')}
            onChange={event => onValueChange(itemPath, event.target.value)}
          />
        )}
      </div>

      {modified && <ModifiedBadge />}
      {overridden && <OverrideBadge />}
      <PathJumpButton path={itemPath} onNavigateToJson={onNavigateToJson} />
      <ArrayItemRemoveButton disabled={fieldDisabled} onRemove={onRemove} />
    </div>
  )
}

/** 对象数组的一项：一行手风琴，默认收起 */
function ObjectArrayItem({
  parentPath,
  index,
  value,
  originalValue,
  disabled,
  depth,
  focusPath,
  highlightedPathKey,
  expandSignal,
  onValueChange,
  onNavigateToJson,
  onRemove,
}: {
  parentPath: ConfigPath
  index: number
  value: Record<string, unknown>
  originalValue: unknown
  disabled: boolean
  depth: number
  focusPath: ConfigPath | null
  highlightedPathKey: string
  expandSignal: ConfigFieldProps['expandSignal']
  onValueChange: (path: ConfigPath, value: ConfigValue) => void
  onNavigateToJson: (path: ConfigPath) => void
  onRemove: () => void
}) {
  const { t } = useTransClient('configManager')
  const overrideMeta = useConfigOverrideMeta()
  const itemPath = [...parentPath, index]
  const pathKey = joinPath(itemPath)
  const originalRecord = isRecord(originalValue) ? originalValue : {}
  const modifiedCount = countModifiedLeafFields(value, originalValue)
  const leafCount = countLeafFields(value)
  const groupChildCount = countGroupChildren(value)
  const overriddenCount = overrideMeta.countOverridden(itemPath)
  const fieldDisabled = disabled || overrideMeta.isProtected(itemPath)
  const fallbackTitle = t('common.arrayItem', { index: index + 1 })
  const title = getArrayItemTitle(value, fallbackTitle)
  const [open, setOpen] = useState(false)
  const focusPathKey = focusPath ? joinPath(focusPath) : ''

  useEffect(() => {
    if (isPathPrefix(itemPath, focusPath))
      setOpen(true)
  }, [focusPath, focusPathKey, pathKey])

  useEffect(() => {
    if (expandSignal)
      setOpen(expandSignal.open)
  }, [expandSignal])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-config-path-key={pathKey}
      className={cn(
        'scroll-mt-24 rounded-lg border border-border',
        getPathHighlightClassName(pathKey, highlightedPathKey),
      )}
    >
      <div className="group/config-item flex items-center justify-between gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150', !open && '-rotate-90')}
            aria-hidden
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            #
            {index + 1}
          </span>
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-1.5">
          {modifiedCount > 0 && <ModifiedBadge count={modifiedCount} />}
          {overriddenCount > 0 && <OverrideBadge count={overriddenCount} />}
          <Badge variant="outline" className={countBadgeClassName}>
            {t('panel.fieldSummary', { count: leafCount })}
          </Badge>
          <PathJumpButton path={itemPath} onNavigateToJson={onNavigateToJson} />
          <ArrayItemRemoveButton disabled={fieldDisabled} onRemove={onRemove} />
        </div>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-7 border-t border-border px-4 py-5">
          {Object.entries(value).map(([key, itemValue]) => (
            <ConfigField
              key={`${pathKey}.${key}`}
              path={[...itemPath, key]}
              fieldKey={key}
              value={itemValue}
              originalValue={originalRecord[key]}
              disabled={fieldDisabled}
              depth={depth + 1}
              siblingGroupCount={groupChildCount}
              focusPath={focusPath}
              highlightedPathKey={highlightedPathKey}
              expandSignal={expandSignal}
              onValueChange={onValueChange}
              onNavigateToJson={onNavigateToJson}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ArrayField({
  path,
  fieldKey,
  value,
  originalValue,
  disabled,
  depth = 0,
  siblingGroupCount = 0,
  contextLabel,
  focusPath,
  highlightedPathKey,
  expandSignal,
  onValueChange,
  onNavigateToJson,
}: ConfigFieldProps & { value: unknown[] }) {
  const { t } = useTransClient('configManager')
  const fieldDescriptions = useConfigFieldDescriptions()
  const overrideMeta = useConfigOverrideMeta()
  const label = getConfigFieldLabel(t, path, fieldKey)
  const description = getConfigFieldDescription(fieldDescriptions, path, fieldKey)
  const pathKey = joinPath(path)
  const sampleValue = value[0] ?? ''
  const originalArray = Array.isArray(originalValue) ? originalValue : []
  const modifiedCount = countModifiedLeafFields(value, originalValue)
  const leafCount = countLeafFields(value)
  const protectedField = overrideMeta.isProtected(path)
  const overriddenCount = overrideMeta.countOverridden(path)
  const fieldDisabled = disabled || protectedField
  const showProtectedHint = protectedField && (overrideMeta.isProtectedRoot(path) || !!contextLabel)
  const [open, setOpen] = useState(() => resolveDefaultOpen(depth, leafCount, siblingGroupCount))
  const focusPathKey = focusPath ? joinPath(focusPath) : ''

  useEffect(() => {
    if (isPathPrefix(path, focusPath))
      setOpen(true)
  }, [focusPath, focusPathKey, pathKey])

  useEffect(() => {
    if (expandSignal)
      setOpen(expandSignal.open)
  }, [expandSignal])

  return (
    <GroupShell
      pathKey={pathKey}
      depth={depth}
      open={open}
      onOpenChange={setOpen}
      label={label}
      description={description}
      contextLabel={contextLabel}
      highlightClassName={getPathHighlightClassName(pathKey, highlightedPathKey)}
      notice={showProtectedHint ? <ProtectedHint /> : undefined}
      trailing={(
        <>
          {modifiedCount > 0 && <ModifiedBadge count={modifiedCount} />}
          {overriddenCount > 0 && <OverrideBadge count={overriddenCount} />}
          {protectedField && <ProtectedBadge />}
          <Badge variant="secondary" className={countBadgeClassName}>
            {t('common.itemCount', { count: value.length })}
          </Badge>
          <PathJumpButton path={path} onNavigateToJson={onNavigateToJson} />
          <ArrayItemAddButton
            disabled={fieldDisabled}
            onAdd={() => onValueChange(path, [...value, createEmptyValue(sampleValue)])}
          />
        </>
      )}
    >
      {value.length === 0
        ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
              {t('common.emptyArray')}
            </p>
          )
        : (
            <div className="flex flex-col gap-3">
              {value.map((item, index) => {
                const itemPathKey = `${pathKey}-${index}`
                const removeItem = () => onValueChange(path, value.filter((_, itemIndex) => itemIndex !== index))

                if (isRecord(item)) {
                  return (
                    <ObjectArrayItem
                      key={itemPathKey}
                      parentPath={path}
                      index={index}
                      value={item}
                      originalValue={originalArray[index]}
                      disabled={fieldDisabled}
                      depth={depth + 1}
                      focusPath={focusPath}
                      highlightedPathKey={highlightedPathKey}
                      expandSignal={expandSignal}
                      onValueChange={onValueChange}
                      onNavigateToJson={onNavigateToJson}
                      onRemove={removeItem}
                    />
                  )
                }

                if (!Array.isArray(item)) {
                  return (
                    <PrimitiveArrayItem
                      key={itemPathKey}
                      parentPath={path}
                      index={index}
                      value={item}
                      originalValue={originalArray[index]}
                      disabled={fieldDisabled}
                      highlightedPathKey={highlightedPathKey}
                      onValueChange={onValueChange}
                      onNavigateToJson={onNavigateToJson}
                      onRemove={removeItem}
                    />
                  )
                }

                return (
                  <ConfigField
                    key={itemPathKey}
                    path={[...path, index]}
                    fieldKey={`${fieldKey}.${index}`}
                    value={item}
                    originalValue={originalArray[index]}
                    disabled={fieldDisabled}
                    depth={depth + 1}
                    focusPath={focusPath}
                    highlightedPathKey={highlightedPathKey}
                    expandSignal={expandSignal}
                    onValueChange={onValueChange}
                    onNavigateToJson={onNavigateToJson}
                  />
                )
              })}
            </div>
          )}
    </GroupShell>
  )
}

function ObjectField({
  path,
  fieldKey,
  value,
  originalValue,
  disabled,
  depth = 0,
  siblingGroupCount = 0,
  contextLabel,
  focusPath,
  highlightedPathKey,
  expandSignal,
  onValueChange,
  onNavigateToJson,
}: ConfigFieldProps & { value: Record<string, unknown> }) {
  const { t } = useTransClient('configManager')
  const fieldDescriptions = useConfigFieldDescriptions()
  const overrideMeta = useConfigOverrideMeta()
  const label = getConfigFieldLabel(t, path, fieldKey)
  const description = getConfigFieldDescription(fieldDescriptions, path, fieldKey)
  const entries = useMemo(() => Object.entries(value), [value])
  const originalRecord = isRecord(originalValue) ? originalValue : {}
  const pathKey = joinPath(path)
  const modifiedCount = countModifiedLeafFields(value, originalValue)
  const leafCount = countLeafFields(value)
  const groupChildCount = countGroupChildren(value)
  const protectedField = overrideMeta.isProtected(path)
  const overriddenCount = overrideMeta.countOverridden(path)
  const fieldDisabled = disabled || protectedField
  const showProtectedHint = protectedField && (overrideMeta.isProtectedRoot(path) || !!contextLabel)
  const [open, setOpen] = useState(() => resolveDefaultOpen(depth, leafCount, siblingGroupCount))
  const focusPathKey = focusPath ? joinPath(focusPath) : ''

  useEffect(() => {
    if (isPathPrefix(path, focusPath))
      setOpen(true)
  }, [focusPath, focusPathKey, pathKey])

  useEffect(() => {
    if (expandSignal)
      setOpen(expandSignal.open)
  }, [expandSignal])

  return (
    <GroupShell
      pathKey={pathKey}
      depth={depth}
      open={open}
      onOpenChange={setOpen}
      label={label}
      description={description}
      contextLabel={contextLabel}
      highlightClassName={getPathHighlightClassName(pathKey, highlightedPathKey)}
      notice={showProtectedHint ? <ProtectedHint /> : undefined}
      trailing={(
        <>
          {modifiedCount > 0 && <ModifiedBadge count={modifiedCount} />}
          {overriddenCount > 0 && <OverrideBadge count={overriddenCount} />}
          {protectedField && <ProtectedBadge />}
          <Badge variant="outline" className={countBadgeClassName}>
            {t('panel.fieldSummary', { count: leafCount })}
          </Badge>
          <PathJumpButton path={path} onNavigateToJson={onNavigateToJson} />
        </>
      )}
    >
      {entries.length === 0
        ? (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
              {t('common.emptyObject')}
            </p>
          )
        : (
            <div className="flex flex-col gap-7">
              {entries.map(([key, itemValue]) => (
                <ConfigField
                  key={`${pathKey}.${key}`}
                  path={[...path, key]}
                  fieldKey={key}
                  value={itemValue}
                  originalValue={originalRecord[key]}
                  disabled={fieldDisabled}
                  depth={depth + 1}
                  siblingGroupCount={groupChildCount}
                  focusPath={focusPath}
                  highlightedPathKey={highlightedPathKey}
                  expandSignal={expandSignal}
                  onValueChange={onValueChange}
                  onNavigateToJson={onNavigateToJson}
                />
              ))}
            </div>
          )}
    </GroupShell>
  )
}

export function ConfigField(props: ConfigFieldProps) {
  const { value } = props

  if (Array.isArray(value))
    return <ArrayField {...props} value={value} />

  if (isRecord(value))
    return <ObjectField {...props} value={value} />

  return <PrimitiveField {...props} />
}
