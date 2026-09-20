/**
 * ConfigFormPanel - 当前分区的参数表单
 *
 * 排版照设置页：**一个分区 = 一组卡片**。
 * - 分区里顶层的基础字段（端口、域名这类）收进一张卡，字段之间 `gap-7` 竖排
 * - 顶层的每个嵌套对象/数组各占一张卡，对象名当卡片小标题，整卡可折叠
 * - 更深的层级由 `ConfigField` 自己折叠，第三层起默认收起
 *
 * 光换排法页面会长到没法用（服务端配置上百个字段），所以这里还多了两件事：
 * **跨分区搜索**（不然找不到东西）和**展开全部 / 收起全部**。
 *
 * 功能一行没动：取值、改值、跳 JSON 都是原来那套，这里只决定谁排在哪张卡里。
 */
'use client'

import type { ConfigFormPanelProps, ConfigPath, ConfigSectionView } from '../../types'
import { ChevronsDownUp, ChevronsUpDown, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isRecord, joinPath } from '../../utils/configPath'
import {
  CONFIG_SEARCH_HIT_LIMIT,
  groupSearchHitsBySection,
  searchConfigFields,
} from '../../utils/configSearch'
import { getConfigSectionValue } from '../../utils/configSections'
import { ConfigField, useConfigFieldDescriptions } from '../ConfigField'
import { ConfigCard, ConfigSectionShell } from '../ConfigSection'

interface SectionLayout {
  /** 顶层的基础字段，全部收进同一张卡 */
  simplePaths: ConfigPath[]
  /** 顶层的嵌套对象/数组，一个一张卡 */
  nodePaths: ConfigPath[]
  cardCount: number
}

/** 把分区里的顶层路径分成「基础字段」和「各自成卡的嵌套节点」 */
function buildSectionLayout(section: ConfigSectionView, config: Record<string, unknown>): SectionLayout {
  const simplePaths: ConfigPath[] = []
  const nodePaths: ConfigPath[] = []

  section.paths.forEach((path) => {
    const value = getConfigSectionValue(config, path)
    if (isRecord(value) || Array.isArray(value))
      nodePaths.push(path)
    else
      simplePaths.push(path)
  })

  return {
    simplePaths,
    nodePaths,
    cardCount: nodePaths.length + (simplePaths.length > 0 ? 1 : 0),
  }
}

export function ConfigFormPanel({
  section,
  sections,
  config,
  originalConfig,
  disabled,
  focusRequest,
  highlightedPathKey,
  searchQuery,
  onSearchQueryChange,
  onSectionSelect,
  onFocusRequestHandled,
  onValueChange,
  onNavigateToJson,
}: ConfigFormPanelProps) {
  const { t } = useTransClient('configManager')
  const fieldDescriptions = useConfigFieldDescriptions()

  // 折叠状态是每个节点自己的 state，只能靠一个每次都换新对象的信号去广播
  const [expandSignal, setExpandSignal] = useState<{ id: number, open: boolean } | null>(null)
  const expandSignalIdRef = useRef(0)

  const emitExpandSignal = (open: boolean) => {
    expandSignalIdRef.current += 1
    setExpandSignal({ id: expandSignalIdRef.current, open })
  }

  // 从 JSON 模式点「定位到可视化字段」过来时，等这一帧渲染完再把目标滚进视野。
  // 用两帧是因为目标可能在折叠节点里，第一帧先把 Collapsible 打开，第二帧才量得到位置。
  useEffect(() => {
    if (!focusRequest)
      return

    const targetPathKey = joinPath(focusRequest.path)
    let firstFrame = 0
    let secondFrame = 0

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = Array.from(document.querySelectorAll<HTMLElement>('[data-config-path-key]'))
          .find(element => element.dataset.configPathKey === targetPathKey)

        if (target)
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })

        onFocusRequestHandled(focusRequest.id)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [focusRequest, onFocusRequestHandled])

  const layout = useMemo(() => buildSectionLayout(section, config), [section, config])

  const trimmedQuery = searchQuery.trim()
  const searchResult = useMemo(
    () => searchConfigFields({
      sections,
      config,
      query: trimmedQuery,
      t,
      descriptions: fieldDescriptions,
    }),
    [sections, config, trimmedQuery, t, fieldDescriptions],
  )
  const searchGroups = useMemo(() => groupSearchHitsBySection(searchResult.hits), [searchResult.hits])

  const toolbar = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative min-w-0 sm:max-w-md sm:flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        {/* 不用 type="search"：Chrome 会自己再画一个清除叉，和右边这个撞在一起 */}
        <Input
          type="text"
          value={searchQuery}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          className="pl-9 pr-10"
          onChange={event => onSearchQueryChange(event.target.value)}
        />
        {searchQuery && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('search.clear')}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => onSearchQueryChange('')}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => emitExpandSignal(true)}>
          <ChevronsUpDown className="size-4" />
          {t('actions.expandAll')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => emitExpandSignal(false)}>
          <ChevronsDownUp className="size-4" />
          {t('actions.collapseAll')}
        </Button>
      </div>
    </div>
  )

  if (trimmedQuery) {
    return (
      <ConfigSectionShell
        title={t('search.resultTitle')}
        desc={t('search.resultDesc', { count: searchResult.total })}
        toolbar={toolbar}
      >
        {searchResult.truncated && (
          <p className="text-sm leading-relaxed text-warning-text">
            {t('search.resultTruncated', { count: CONFIG_SEARCH_HIT_LIMIT })}
          </p>
        )}

        {searchGroups.length === 0
          ? (
              <ConfigCard>
                <p className="text-sm text-foreground">{t('search.empty')}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('search.emptyHint')}</p>
              </ConfigCard>
            )
          : searchGroups.map(group => (
              <ConfigCard key={group.sectionId}>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{group.sectionLabel}</h3>
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 py-0 text-[11px] font-normal leading-none">
                      {t('panel.fieldSummary', { count: group.hits.length })}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onSectionSelect(group.sectionId)}
                  >
                    {t('search.openSection')}
                  </Button>
                </div>

                <div className="flex flex-col gap-7">
                  {group.hits.map(hit => (
                    <ConfigField
                      key={joinPath(hit.path)}
                      path={hit.path}
                      fieldKey={String(hit.path[hit.path.length - 1] ?? group.sectionId)}
                      value={getConfigSectionValue(config, hit.path)}
                      originalValue={originalConfig ? getConfigSectionValue(originalConfig, hit.path) : undefined}
                      disabled={disabled}
                      depth={1}
                      siblingGroupCount={group.hits.length}
                      contextLabel={hit.breadcrumb}
                      focusPath={focusRequest?.path ?? null}
                      highlightedPathKey={highlightedPathKey}
                      expandSignal={expandSignal}
                      onValueChange={onValueChange}
                      onNavigateToJson={onNavigateToJson}
                    />
                  ))}
                </div>
              </ConfigCard>
            ))}
      </ConfigSectionShell>
    )
  }

  return (
    <ConfigSectionShell
      title={section.label}
      desc={section.description}
      toolbar={toolbar}
      badge={section.notRecommended
        ? (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 font-normal text-warning-text">
              {t('status.notRecommended')}
            </Badge>
          )
        : undefined}
    >
      {layout.simplePaths.length > 0 && (
        <ConfigCard>
          <div className="flex flex-col gap-7">
            {layout.simplePaths.map(path => (
              <ConfigField
                key={joinPath(path)}
                path={path}
                fieldKey={String(path[path.length - 1] ?? section.id)}
                value={getConfigSectionValue(config, path)}
                originalValue={originalConfig ? getConfigSectionValue(originalConfig, path) : undefined}
                disabled={disabled}
                depth={1}
                focusPath={focusRequest?.path ?? null}
                highlightedPathKey={highlightedPathKey}
                expandSignal={expandSignal}
                onValueChange={onValueChange}
                onNavigateToJson={onNavigateToJson}
              />
            ))}
          </div>
        </ConfigCard>
      )}

      {layout.nodePaths.map(path => (
        <ConfigField
          key={joinPath(path)}
          path={path}
          fieldKey={String(path[path.length - 1] ?? section.id)}
          value={getConfigSectionValue(config, path)}
          originalValue={originalConfig ? getConfigSectionValue(originalConfig, path) : undefined}
          disabled={disabled}
          depth={0}
          siblingGroupCount={layout.cardCount}
          focusPath={focusRequest?.path ?? null}
          highlightedPathKey={highlightedPathKey}
          expandSignal={expandSignal}
          onValueChange={onValueChange}
          onNavigateToJson={onNavigateToJson}
        />
      ))}
    </ConfigSectionShell>
  )
}
