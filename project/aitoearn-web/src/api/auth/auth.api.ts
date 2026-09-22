/**
 * 认证相关接口
 *
 * 自部署只走 Pocket ID（OIDC）登录，所以这里**没有**邮箱/手机验证码登录和 Google 登录——
 * 对应的 `login/mail`、`login/phone`、`login/google` 连同它们的表单一起删了。
 * 登录入口在 `[lng]/auth/login/components/LoginContent/OidcLoginButton.tsx`。
 */
import type { AuthRequestOptions, UpdateUserInfoParams } from './auth.types'
import type { UserInfo } from '@/store/user'
import type { RequestOptions } from '@/utils/request'
import http from '@/utils/request'

/**
 * Get Current User Information
 * Retrieve the profile of the authenticated user.
 */
export function getUserInfoApi(options?: RequestOptions & AuthRequestOptions) {
  const { silent, ...requestOptions } = options ?? {}
  return http.get<UserInfo>('user/mine', undefined, silent, requestOptions)
}

/**
 * Update User Information
 * Update the profile of the authenticated user.
 */
export function updateUserInfoApi(data: UpdateUserInfoParams) {
  return http.put<UserInfo>('user/info/update', data)
}
