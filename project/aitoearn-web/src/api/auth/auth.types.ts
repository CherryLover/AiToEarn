/**
 * 认证相关类型
 *
 * 自部署只走 Pocket ID（OIDC）登录。邮箱/手机验证码登录和 Google 登录的参数类型
 * 随对应表单和接口一起删了，别再照着上游补回来。
 */

/**
 * 鉴权请求选项。
 */
export interface AuthRequestOptions {
  silent?: boolean
}

/**
 * 更新用户信息请求参数。
 */
export interface UpdateUserInfoParams {
  name: string
  avatar?: string
}
