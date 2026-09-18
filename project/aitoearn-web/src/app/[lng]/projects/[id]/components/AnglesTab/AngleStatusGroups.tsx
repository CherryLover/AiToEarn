/**
 * AngleStatusGroups - 方向按状态分组
 * 候选 / 测试中 / 有效 / 已淘汰各一栏，空栏也留着，让人知道下一步该往哪推。
 */
'use client'

import type { Angle, AngleStatus } from '@/api/angles/angle.types'
import { ANGLE_STATUS_ORDER } from '@/api/angles/angle.constants'
import { useTransClient } from '@/app/i18n/client'
import { AngleCard } from './AngleCard'

interface AngleStatusGroupsProps {
  groups: Record<AngleStatus, Angle[]>
  /** 每个方向底下挂了几个直接子方向，分组视图里也标出来 */
  childCounts: Record<string, number>
  readOnly: boolean
  updatingId: string | null
  onStatusChange: (angle: Angle, status: AngleStatus) => void
  onDerive: (angle: Angle) => void
  onEdit: (angle: Angle) => void
  onDelete: (angle: Angle) => void
}

export function AngleStatusGroups(props: AngleStatusGroupsProps) {
  const { groups, childCounts, readOnly, updatingId } = props
  const { t } = useTransClient('projects')

  return (
    <div className="flex flex-col gap-6">
      {ANGLE_STATUS_ORDER.map((status) => {
        const list = groups[status] ?? []

        return (
          <section key={status}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h4 className="text-sm font-medium text-foreground">{t(`angles.status.${status}`)}</h4>
              <span className="text-xs text-muted-foreground">
                {t('angles.group.count', { num: list.length })}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t(`angles.statusDesc.${status}`)}</p>

            {list.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
                {t('angles.group.empty')}
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {list.map(angle => (
                  <AngleCard
                    key={angle.id}
                    angle={angle}
                    childCount={childCounts[angle.id] ?? 0}
                    readOnly={readOnly}
                    isUpdating={updatingId === angle.id}
                    onStatusChange={props.onStatusChange}
                    onDerive={props.onDerive}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
