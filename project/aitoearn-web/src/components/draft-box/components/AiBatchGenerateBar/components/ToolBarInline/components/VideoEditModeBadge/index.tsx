import type { VideoEditModeBadgeProps } from '../../types'
import { Video } from 'lucide-react'

export function VideoEditModeBadge({ label }: VideoEditModeBadgeProps) {
  // 同目录 utils/styles.ts 的徽章上一轮已经换成主题变量，这一支漏了。
  // 换 info 口径后 5.51:1（亮）/ 6.22:1（暗），原来 4.75 / 5.78。
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-info/30 bg-info/10 text-info">
      <Video className="h-3 w-3" />
      {label}
    </span>
  )
}
