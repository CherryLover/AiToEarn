/**
 * 上传卡片里的说明：zip 技能包长什么样、有哪些规矩、scripts/ 里的脚本能不能跑。
 *
 * scripts/ 那一句必须单独摆出来：人传了脚本，很自然会以为 AI 会去跑它。
 * 实际上脚本只会原样存下、AI 能读到内容，但现在 AI 没有执行命令的能力。不说清楚就是在骗人。
 */

'use client'

import { Info } from 'lucide-react'
import { useTransClient } from '@/app/i18n/client'

/**
 * 目录结构示意。路径部分是字面量（等宽字体、不翻译），右边的注释走文案键。
 * `my-skill` 只是示例名，真正的技能名以 SKILL.md 里的 name 为准。
 */
const TREE_ROWS: { path: string, note?: string }[] = [
  { path: 'my-skill.zip' },
  { path: '└─ my-skill/', note: 'skills.upload.tree.folder' },
  { path: '   ├─ SKILL.md', note: 'skills.upload.tree.entry' },
  { path: '   ├─ references/', note: 'skills.upload.tree.references' },
  { path: '   ├─ scripts/', note: 'skills.upload.tree.scripts' },
  { path: '   └─ …', note: 'skills.upload.tree.more' },
]

export function SkillUploadGuide() {
  const { t } = useTransClient('settings')

  return (
    <div className="flex flex-col gap-4">
      <figure className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <figcaption className="mb-2 text-xs font-medium text-foreground">
          {t('skills.upload.treeLabel')}
        </figcaption>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs leading-relaxed">
          {TREE_ROWS.map(row => (
            <div key={row.path} className="contents">
              <span className="whitespace-pre font-mono text-foreground">{row.path}</span>
              <span className="text-muted-foreground">{row.note ? t(row.note) : ''}</span>
            </div>
          ))}
        </div>
      </figure>

      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
        <li>{t('skills.upload.rules.location')}</li>
        <li>{t('skills.upload.rules.name')}</li>
        <li>{t('skills.upload.rules.limits')}</li>
      </ul>

      <div className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-xs leading-relaxed text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{t('skills.upload.scriptsNote')}</span>
      </div>
    </div>
  )
}
