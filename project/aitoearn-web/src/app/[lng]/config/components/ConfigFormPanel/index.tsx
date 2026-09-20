/**
 * ConfigFormPanel - 当前分区的参数表单
 *
 * 和弹窗版的区别只有一个：弹窗把所有分区堆在一个滚动容器里、靠滚动监听高亮左侧目录；
 * 页面版一次只渲染选中的那个分区，滚动交回给页面本身，所以滚动监听那套（`useConfigSectionSpy`）
 * 整个不要了。字段渲染仍然走原来的 `ConfigField`，一行没改。
 */
'use client'

import type { ConfigFormPanelProps } from '../../types'
import { useEffect } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { joinPath } from '../../utils/configPath'
import { getConfigSectionValue } from '../../utils/configSections'
import { ConfigField } from '../ConfigField'
import { ConfigCard, ConfigSectionShell } from '../ConfigSection'

export function ConfigFormPanel({
  section,
  config,
  originalConfig,
  disabled,
  focusRequest,
  highlightedPathKey,
  onFocusRequestHandled,
  onValueChange,
  onNavigateToJson,
}: ConfigFormPanelProps) {
  const { t } = useTransClient('configManager')

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

  return (
    <ConfigSectionShell
      title={section.label}
      desc={section.description}
      badge={section.notRecommended
        ? (
            <Badge variant="outline" className="border-warning/30 bg-warning/10 font-normal text-warning-text">
              {t('status.notRecommended')}
            </Badge>
          )
        : undefined}
    >
      <ConfigCard className="overflow-hidden p-0 md:p-0">
        <div className="divide-y divide-border/70">
          {section.paths.map((path) => {
            const value = getConfigSectionValue(config, path)
            const originalValue = originalConfig ? getConfigSectionValue(originalConfig, path) : undefined
            const fieldKey = String(path[path.length - 1] ?? section.id)

            return (
              <ConfigField
                key={joinPath(path)}
                path={path}
                fieldKey={fieldKey}
                value={value}
                originalValue={originalValue}
                disabled={disabled}
                focusPath={focusRequest?.path ?? null}
                highlightedPathKey={highlightedPathKey}
                onValueChange={onValueChange}
                onNavigateToJson={onNavigateToJson}
              />
            )
          })}
        </div>
      </ConfigCard>
    </ConfigSectionShell>
  )
}
