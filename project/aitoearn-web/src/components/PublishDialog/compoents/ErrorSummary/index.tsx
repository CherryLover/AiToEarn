/**
 * ErrorSummary - 错误汇总组件
 *
 * 功能：
 * - 在发布弹框中集中展示所有选中账号的校验错误和警告信息
 * - 支持显示每个账号的所有错误和警告
 * - 支持收起/展开
 * - 点击账号可跳转到该账号的参数设置
 */

'use client'

import type {
  ErrPubParamsItem,
  ErrPubParamsMapType,
} from '@/components/PublishDialog/hooks/usePubParamsVerify'
import type { PubItem } from '@/components/PublishDialog/publishDialog.type'
import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import AvatarPlat from '@/components/common/AvatarPlat'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { usePlatformInfoMap } from '@/hooks/usePlatformMetadata'
import { cn } from '@/utils/className'

export interface IErrorSummaryProps {
  // 选中的发布列表
  pubListChoosed: PubItem[]
  // 错误参数映射
  errParamsMap?: ErrPubParamsMapType
  // 警告参数映射
  warningParamsMap?: ErrPubParamsMapType
  // 点击账号时的回调
  onAccountClick?: (accountId: string) => void
}

// 单个账号的问题项
interface AccountIssue {
  pubItem: PubItem
  errors: string[]
  warnings: string[]
}

const ErrorSummary = memo(
  ({ pubListChoosed, errParamsMap, warningParamsMap, onAccountClick }: IErrorSummaryProps) => {
    const { t } = useTransClient('publish')
    const [isOpen, setIsOpen] = useState(false)
    const platformInfoMap = usePlatformInfoMap()

    // 筛选出有错误或警告的账号列表
    const accountsWithIssues = useMemo(() => {
      const issues: AccountIssue[] = []

      for (const pubItem of pubListChoosed) {
        const accountId = pubItem.account.id
        const errorItem = errParamsMap?.get(accountId)
        const warningItem = warningParamsMap?.get(accountId)

        // 获取所有错误消息（优先使用 parErrMsgs 数组，兼容旧版 parErrMsg）
        const errors = getMessages(errorItem)
        const warnings = getMessages(warningItem)

        // 只要有错误或警告就加入列表
        if (errors.length > 0 || warnings.length > 0) {
          issues.push({
            pubItem,
            errors,
            warnings,
          })
        }
      }

      return issues
    }, [pubListChoosed, errParamsMap, warningParamsMap])

    // 如果没有问题，不显示组件
    if (accountsWithIssues.length === 0) {
      return null
    }

    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-4">
        {/* 标题栏 - 可点击收起/展开 */}
        {/*
          整块原来是写死的 yellow/amber 色阶，亮色下多处不过线：
          图标 text-yellow-600 压 bg-yellow-50 只有 2.84:1（图标门槛 3:1），
          平台名 text-yellow-600 2.94:1、warning 图标 text-amber-600 3.07:1（正文门槛 4.5:1）。
          统一换站里的告警口径 border-warning/30 + bg-warning/10 + text-warning-text 之后：
          图标和次要文字 5.18:1（亮）/ 6.55:1（暗），标题 text-foreground 15.72 / 12.07，
          正文 text-muted-foreground 4.93 / 5.22，行底 bg-warning/5 上分别是 5.47 / 7.25 和 5.20 / 5.78。
        */}
        <CollapsibleTrigger className="flex w-full items-center gap-2 p-3 rounded-t-md bg-warning/10 border border-warning/30 hover:bg-warning/15 transition-colors cursor-pointer">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-warning-text shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-warning-text shrink-0" />
          )}
          <AlertTriangle className="h-4 w-4 text-warning-text shrink-0" />
          <span className="text-sm font-medium text-foreground">
            {t('errorSummary.title', { count: accountsWithIssues.length })}
          </span>
        </CollapsibleTrigger>

        {/* 账号问题列表 */}
        <CollapsibleContent className="border border-t-0 border-warning/30 rounded-b-md overflow-hidden">
          <div className="divide-y divide-warning/30">
            {accountsWithIssues.map(({ pubItem, errors, warnings }) => {
              const platConfig = platformInfoMap.get(pubItem.account.type)

              return (
                <div
                  key={pubItem.account.id}
                  className={cn(
                    'p-3 bg-warning/5',
                    onAccountClick && 'cursor-pointer hover:bg-warning/10 transition-colors',
                  )}
                  onClick={() => onAccountClick?.(pubItem.account.id)}
                >
                  {/* 账号信息 */}
                  <div className="flex items-center gap-2 mb-2">
                    <AvatarPlat account={pubItem.account} size="small" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {pubItem.account.nickname}
                    </span>
                    {platConfig && (
                      <span className="text-xs text-warning-text shrink-0">
                        {platConfig.name}
                      </span>
                    )}
                  </div>

                  {/* 错误信息列表 - 黄色 */}
                  {errors.map((errMsg, index) => (
                    <div key={`error-${index}`} className="ml-8 flex items-start gap-1.5 mb-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-warning-text shrink-0 mt-0.5" />
                      <span className="text-xs text-muted-foreground">{errMsg}</span>
                    </div>
                  ))}

                  {/* 警告信息列表 - 琥珀/橙色 */}
                  {warnings.map((warnMsg, index) => (
                    <div
                      key={`warning-${index}`}
                      className="ml-8 flex items-start gap-1.5 mb-1 last:mb-0"
                    >
                      <Info className="h-3.5 w-3.5 text-warning-text shrink-0 mt-0.5" />
                      <span className="text-xs text-muted-foreground">{warnMsg}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  },
)

/**
 * 从 ErrPubParamsItem 中获取所有消息
 * 优先使用 parErrMsgs 数组，兼容旧版 parErrMsg
 */
function getMessages(item?: ErrPubParamsItem): string[] {
  if (!item)
    return []

  // 优先使用 parErrMsgs 数组
  if (item.parErrMsgs && item.parErrMsgs.length > 0) {
    return item.parErrMsgs
  }

  // 兼容旧版 parErrMsg
  if (item.parErrMsg) {
    return [item.parErrMsg]
  }

  return []
}

ErrorSummary.displayName = 'ErrorSummary'

export default ErrorSummary
