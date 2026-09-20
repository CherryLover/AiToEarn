/**
 * 个人资料分区 - 头像与昵称
 * 从原来的设置弹窗 ProfileTab 搬过来重新排版：
 * 昵称不再是「点一下文字变输入框」那种藏起来的交互，改成正经的带标签的表单字段 + 显式保存。
 */

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Camera } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useShallow } from 'zustand/shallow'
import { updateUserInfoApi } from '@/api/auth/auth.api'
import { uploadToOss } from '@/api/materials/material.api'
import { useTransClient } from '@/app/i18n/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useUserStore } from '@/store/user'
import { cn } from '@/utils/className'
import { getOssUrl } from '@/utils/oss'
import { toast } from '@/utils/ui/toast'
import { SettingsCard, SettingsSection } from '../SettingsSection'
import { AvatarCropModal } from './AvatarCropModal'

/** 昵称长度限制，跟服务端保持一致 */
const NAME_MIN_LENGTH = 2
const NAME_MAX_LENGTH = 20

/** 头像文件大小上限 */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024

interface ProfileFormData {
  name: string
}

export function ProfileSection() {
  const { t } = useTransClient('settings')
  const { t: tCommon } = useTransClient('common')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { userInfo, getUserInfo } = useUserStore(
    useShallow(state => ({
      userInfo: state.userInfo,
      getUserInfo: state.getUserInfo,
    })),
  )

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const avatarUrl = userInfo?.avatar ? getOssUrl(userInfo.avatar) : ''
  const currentName = userInfo?.name || ''

  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t('profile.nameRequired'))
          .min(NAME_MIN_LENGTH, t('profile.nameLengthError'))
          .max(NAME_MAX_LENGTH, t('profile.nameLengthError')),
      }),
    [t],
  )

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: currentName },
    mode: 'onSubmit',
  })

  // 用户信息刷新后把表单重置成最新值，重置也会把 isDirty 清掉
  useEffect(() => {
    form.reset({ name: currentName })
  }, [currentName, form])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file)
      return

    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.avatarTypeError'))
      return
    }

    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(t('profile.avatarSizeError'))
      return
    }

    setSelectedFile(file)
    setCropModalOpen(true)

    if (fileInputRef.current)
      fileInputRef.current.value = ''
  }

  const handleCropComplete = async (blob: Blob) => {
    setIsUploadingAvatar(true)
    try {
      const file = new File([blob], `avatar_${Date.now()}.png`, { type: 'image/png' })
      const ossPath = await uploadToOss(file)

      const response = await updateUserInfoApi({
        name: userInfo?.name || '',
        avatar: ossPath,
      })

      if (response?.code === 0 && response.data) {
        await getUserInfo()
        toast.success(t('profile.avatarUpdateSuccess'))
        setCropModalOpen(false)
        setSelectedFile(null)
        return
      }

      toast.error(response?.message || t('profile.avatarUpdateFailed'))
    }
    catch (error) {
      console.error('Upload avatar failed:', error)
      toast.error(t('profile.avatarUpdateFailed'))
    }
    finally {
      setIsUploadingAvatar(false)
    }
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      const response = await updateUserInfoApi({
        name: values.name.trim(),
        avatar: userInfo?.avatar,
      })

      if (response?.code === 0 && response.data) {
        await getUserInfo()
        toast.success(t('profile.nameUpdateSuccess'))
        form.reset({ name: values.name.trim() })
        return
      }

      toast.error(response?.message || t('profile.nameUpdateFailed'))
    }
    catch (error) {
      console.error('Update profile failed:', error)
      toast.error(t('profile.nameUpdateFailed'))
    }
  })

  const isSaving = form.formState.isSubmitting
  const isDirty = form.formState.isDirty
  const account
    = userInfo?.mail
      || (userInfo?.phone ? userInfo.phone.replace(/^(.{3}).*(.{4})$/, '$1****$2') : '')

  return (
    <SettingsSection title={t('nav.profile')} desc={t('profile.desc')}>
      <SettingsCard title={t('profile.avatarLabel')} desc={t('profile.avatarDesc')}>
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            className="group relative shrink-0 rounded-full"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('profile.changeAvatar')}
          >
            <Avatar className="size-20">
              <AvatarImage src={avatarUrl} alt={currentName} />
              <AvatarFallback>{currentName.charAt(0)?.toUpperCase() || 'U'}</AvatarFallback>
            </Avatar>
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center rounded-full bg-black/50 transition-opacity',
                isUploadingAvatar ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              {isUploadingAvatar
                ? <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <Camera size={20} className="text-white" />}
            </span>
          </button>

          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingAvatar}
          >
            {t('profile.changeAvatar')}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </SettingsCard>

      <SettingsCard>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('profile.nameLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={NAME_MAX_LENGTH}
                      placeholder={t('profile.namePlaceholder')}
                      className="sm:max-w-md"
                    />
                  </FormControl>
                  <FormDescription>{t('profile.nameDesc')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium leading-none text-foreground">
                {t('profile.accountLabel')}
              </span>
              <p className="text-sm text-foreground">{account || tCommon('unknownUser')}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('profile.accountDesc')}
              </p>
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-5">
              <Button type="submit" disabled={!isDirty || isSaving} loading={isSaving}>
                {isSaving ? t('profile.saving') : t('profile.save')}
              </Button>
              {isDirty && !isSaving && (
                <span className="text-sm text-muted-foreground">{t('form.unsaved')}</span>
              )}
            </div>
          </form>
        </Form>
      </SettingsCard>

      <SettingsCard title={t('profile.linksLabel')} desc={t('profile.linksDesc')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <a href="https://docs.aitoearn.ai/" target="_blank" rel="noopener noreferrer">
              {tCommon('docs')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href="https://github.com/yikart/AttAiToEarn"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('profile.githubStars')}
            </a>
          </Button>
        </div>
      </SettingsCard>

      <AvatarCropModal
        open={cropModalOpen}
        onClose={() => {
          setCropModalOpen(false)
          setSelectedFile(null)
        }}
        imageFile={selectedFile}
        onCropComplete={handleCropComplete}
        isUploading={isUploadingAvatar}
      />
    </SettingsSection>
  )
}
