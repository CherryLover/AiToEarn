/**
 * AngleTree - 方向演进树
 * 子方向缩进挂在父方向下面，连线把血统画出来：
 * 哪条线一直在往下长、哪条试了两次就停了，扫一眼就看得出来。
 */
'use client'

import type { Angle, AngleStatus, AngleTreeNode } from '@/api/angles/angle.types'
import { cn } from '@/utils/className'
import { AngleCard } from './AngleCard'

interface AngleTreeProps {
  nodes: AngleTreeNode[]
  readOnly: boolean
  updatingId: string | null
  onStatusChange: (angle: Angle, status: AngleStatus) => void
  onGenerate: (angle: Angle) => void
  onDerive: (angle: Angle) => void
  onEdit: (angle: Angle) => void
  onDelete: (angle: Angle) => void
}

type AngleTreeLevelProps = AngleTreeProps & { depth: number }

function AngleTreeLevel(props: AngleTreeLevelProps) {
  const { nodes, depth, ...rest } = props

  return (
    <ul
      className={cn(
        'flex flex-col gap-3',
        depth > 0 && 'ml-3 mt-3 border-l border-dashed border-border pl-5',
      )}
    >
      {nodes.map(node => (
        <li key={node.id} className="relative">
          {depth > 0 && (
            // 从父级那根竖线拉出来的横线，接到这张卡片上
            <span
              aria-hidden
              className="absolute -left-5 top-7 h-px w-5 border-t border-dashed border-border"
            />
          )}

          <AngleCard
            angle={node}
            childCount={node.children.length}
            readOnly={rest.readOnly}
            isUpdating={rest.updatingId === node.id}
            onStatusChange={rest.onStatusChange}
            onGenerate={rest.onGenerate}
            onDerive={rest.onDerive}
            onEdit={rest.onEdit}
            onDelete={rest.onDelete}
          />

          {node.children.length > 0 && (
            <AngleTreeLevel {...rest} nodes={node.children} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  )
}

export function AngleTree(props: AngleTreeProps) {
  return <AngleTreeLevel {...props} depth={0} />
}
