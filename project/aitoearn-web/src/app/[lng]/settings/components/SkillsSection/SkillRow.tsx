/**
 * 技能列表里的一行：名字、说明、结构摘要，自定义的带删除按钮。
 *
 * 结构摘要是给人一眼看清「这个技能里装了什么」的：
 * 「SKILL.md · references/ 3 个 · scripts/ 1 个 · 其他 2 个」。
 * 只有一个 SKILL.md 时摘要就是全部，不给展开；有别的文件才能点开看完整列表，默认收起。
 */

'use client'

import type { SkillFileSummary } from './skills.utils'
import type { Skill } from '@/api/skills/skill.types'
import { ChevronRight, FileText, FolderOpen, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/utils/className'
import { hasExtraSkillFiles, SKILL_ENTRY_FILE, summarizeSkillFiles } from './skills.utils'

interface SkillRowProps {
  skill: Skill
  /** 不给就不渲染删除按钮：内置技能走这条 */
  onDelete?: () => void
}

export function SkillRow({ skill, onDelete }: SkillRowProps) {
  const { t } = useTransClient('settings')
  const summary = useMemo(() => summarizeSkillFiles(skill.files), [skill.files])
  const Icon = hasExtraSkillFiles(summary) ? FolderOpen : FileText

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border px-3 py-2.5',
        skill.builtin && 'bg-muted/30',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-foreground">{skill.name}</span>
          {skill.builtin && (
            <Badge variant="outline" className="text-[11px]">{t('skills.builtinTag')}</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {skill.description || t('skills.noDescription')}
        </p>
        <SkillFiles files={skill.files} summary={summary} />
      </div>
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          {t('skills.delete.action')}
        </Button>
      )}
    </li>
  )
}

/** 结构摘要 + 可展开的完整文件列表 */
function SkillFiles({ files, summary }: { files: Skill['files'], summary: SkillFileSummary }) {
  const { t } = useTransClient('settings')
  const [open, setOpen] = useState(false)

  // 服务端没给 files（比如还没升级）就什么都不摆，别显示一个空摘要
  if (summary.total === 0)
    return null

  const parts: string[] = []
  if (summary.hasEntry)
    parts.push(SKILL_ENTRY_FILE)
  for (const dir of summary.dirs) {
    parts.push(t('skills.structure.dir', {
      name: dir.name,
      count: dir.count,
      interpolation: { escapeValue: false },
    }))
  }
  if (summary.rootOthers > 0)
    parts.push(t('skills.structure.other', { count: summary.rootOthers }))
  const text = parts.join(' · ')

  if (!hasExtraSkillFiles(summary))
    return <p className="mt-1.5 text-xs text-muted-foreground">{text}</p>

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1.5">
      <CollapsibleTrigger className="-mx-1 inline-flex max-w-full cursor-pointer items-start gap-1 rounded px-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          className={cn('mt-px size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')}
          aria-hidden
        />
        <span className="min-w-0">{text}</span>
        <span className="sr-only">{open ? t('skills.structure.hide') : t('skills.structure.show')}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
          {[...new Set(files)].map(path => (
            <li key={path} className="break-all">{path}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
