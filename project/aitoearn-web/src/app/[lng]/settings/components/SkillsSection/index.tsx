/**
 * AI 技能分区 - 看有哪些技能，传自己的上去
 *
 * 两件事写在最前面：
 *
 * 1. **这里传的技能对整个部署里所有人生效。** 不按用户隔离（契约第三节说明了为什么），
 *    所以界面上必须把这句话摆在最显眼的地方——人得知道自己在改的是所有人的 AI。
 * 2. **技能是写给 AI 看的指令。** 传一个技能等于往 AI 的执行上下文里塞一段话，
 *    这不是普通的文件上传。文案上要让人意识到这一点，不要做成一个轻飘飘的「拖进来就行」。
 *
 * 校验在服务端，这里只做两件本地就能判的事：后缀和大小。
 * 提前挡住能省一次往返，但**不能只靠前端**——服务端那边一样要判。
 */

'use client'

import type { Skill } from '@/api/skills/skill.types'
import { FileText, Loader2, RefreshCw, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteSkillApi, getSkillListApi, uploadSkillApi } from '@/api/skills/skill.api'
import { MAX_SKILL_FILE_BYTES, SKILL_ERROR_CODE } from '@/api/skills/skill.constants'
import { useTransClient } from '@/app/i18n/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { SettingsCard, SettingsSection } from '../SettingsSection'

/** 把服务端的业务码翻成 settings 命名空间下的文案键 */
function getSkillErrorKey(code?: string | number | null): string {
  switch (Number(code)) {
    case SKILL_ERROR_CODE.NameInvalid:
      return 'skills.error.nameInvalid'
    case SKILL_ERROR_CODE.NameReserved:
      return 'skills.error.nameReserved'
    case SKILL_ERROR_CODE.FrontmatterMissing:
      return 'skills.error.frontmatterMissing'
    case SKILL_ERROR_CODE.FileTooLarge:
      return 'skills.error.fileTooLarge'
    case SKILL_ERROR_CODE.FileInvalid:
      return 'skills.error.fileInvalid'
    case SKILL_ERROR_CODE.AlreadyExists:
      return 'skills.error.alreadyExists'
    case SKILL_ERROR_CODE.NotFound:
      return 'skills.error.notFound'
    case SKILL_ERROR_CODE.BuiltinReadonly:
      return 'skills.error.builtinReadonly'
    case SKILL_ERROR_CODE.StorageUnavailable:
      return 'skills.error.storageUnavailable'
    default:
      return 'skills.error.unknown'
  }
}

export function SkillsSection() {
  const { t } = useTransClient('settings')

  const [skills, setSkills] = useState<Skill[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  /** 重名时先扣在这儿，等人点了「覆盖」再传一次 */
  const [overwriteTarget, setOverwriteTarget] = useState<File | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await getSkillListApi()
      if (res?.code === 0 && Array.isArray(res.data?.list)) {
        setSkills(res.data.list)
        setLoadFailed(false)
      }
      else {
        setSkills([])
        setLoadFailed(true)
      }
    }
    catch (error) {
      console.error('Load skills failed:', error)
      setSkills([])
      setLoadFailed(true)
    }
    finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const upload = useCallback(async (file: File, overwrite: boolean) => {
    setIsUploading(true)
    try {
      const res = await uploadSkillApi({ file, overwrite })
      if (res?.code === 0) {
        toast.success(t('skills.uploadSuccess'))
        setOverwriteTarget(null)
        await load()
        return
      }

      // 重名不是错，是一个要人点头的岔路：扣住文件问一句要不要覆盖
      if (Number(res?.code) === SKILL_ERROR_CODE.AlreadyExists && !overwrite) {
        setOverwriteTarget(file)
        return
      }

      toast.error(t(getSkillErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Upload skill failed:', error)
      toast.error(t('skills.error.unknown'))
    }
    finally {
      setIsUploading(false)
    }
  }, [load, t])

  const handlePick = useCallback((file: File | undefined) => {
    if (!file)
      return

    // 后缀和大小本地就能判，先挡一道省一次往返；服务端那边一样会判
    if (!file.name.toLowerCase().endsWith('.md')) {
      toast.error(t('skills.error.fileInvalid'))
      return
    }
    if (file.size > MAX_SKILL_FILE_BYTES) {
      toast.error(t('skills.error.fileTooLarge'))
      return
    }

    void upload(file, false)
  }, [t, upload])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || isDeleting)
      return

    setIsDeleting(true)
    try {
      const res = await deleteSkillApi(deleteTarget.name)
      if (res?.code === 0) {
        toast.success(t('skills.deleteSuccess'))
        setDeleteTarget(null)
        await load()
        return
      }
      toast.error(t(getSkillErrorKey(res?.code)))
    }
    catch (error) {
      console.error('Delete skill failed:', error)
      toast.error(t('skills.error.unknown'))
    }
    finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, isDeleting, load, t])

  const custom = skills.filter(skill => !skill.builtin)
  const builtin = skills.filter(skill => skill.builtin)

  return (
    <SettingsSection title={t('skills.title')} desc={t('skills.desc')}>
      {/* 全局生效这件事必须摆在最前面，不能让人传完才发现 */}
      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" />
        <span>{t('skills.globalWarning')}</span>
      </div>

      <SettingsCard title={t('skills.upload.title')} desc={t('skills.upload.desc')}>
        <input
          ref={inputRef}
          type="file"
          accept=".md,text/markdown"
          className="hidden"
          onChange={(event) => {
            handlePick(event.target.files?.[0])
            // 清掉值，否则连续传同一个文件不会再触发 change
            event.target.value = ''
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={isUploading} onClick={() => inputRef.current?.click()}>
            {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {isUploading ? t('skills.upload.uploading') : t('skills.upload.pick')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('skills.upload.hint')}</span>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('skills.custom.title')}
        desc={t('skills.custom.desc')}
      >
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : loadFailed ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t('skills.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="size-4" />
              {t('skills.retry')}
            </Button>
          </div>
        ) : custom.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('skills.custom.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {custom.map(skill => (
              <SkillRow
                key={skill.name}
                skill={skill}
                onDelete={() => setDeleteTarget(skill)}
              />
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title={t('skills.builtin.title')} desc={t('skills.builtin.desc')}>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <ul className="flex flex-col gap-2">
            {builtin.map(skill => <SkillRow key={skill.name} skill={skill} />)}
          </ul>
        )}
      </SettingsCard>

      {/* 重名：扣住文件问一句，点了才真的盖 */}
      <AlertDialog
        open={Boolean(overwriteTarget)}
        onOpenChange={open => !open && setOverwriteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('skills.overwrite.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('skills.overwrite.desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUploading}>{t('skills.overwrite.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isUploading}
              onClick={(event) => {
                event.preventDefault()
                if (overwriteTarget)
                  void upload(overwriteTarget, true)
              }}
            >
              {t('skills.overwrite.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('skills.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('skills.delete.desc', {
                name: deleteTarget?.name ?? '',
                interpolation: { escapeValue: false },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('skills.delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault()
                handleDelete()
              }}
            >
              {isDeleting ? t('skills.delete.deleting') : t('skills.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

function SkillRow({ skill, onDelete }: { skill: Skill, onDelete?: () => void }) {
  const { t } = useTransClient('settings')

  return (
    <li className={cn(
      'flex items-start gap-3 rounded-lg border border-border px-3 py-2.5',
      skill.builtin && 'bg-muted/30',
    )}
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
