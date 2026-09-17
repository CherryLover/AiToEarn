import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Public } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { Request, Response } from 'express'
import { OidcLoginError, OidcLoginService } from './oidc-login.service'

const STATE_COOKIE = 'aitoearn_oidc_state'
const DEFAULT_LNG = 'zh-CN'

function normalizeLng(lng?: string) {
  return lng && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(lng) ? lng : DEFAULT_LNG
}

function errorCode(error: unknown) {
  return error instanceof OidcLoginError ? error.code : 'unknown_error'
}

@ApiTags('Auth/OIDC')
@Controller('auth/oidc')
export class OidcLoginController {
  private readonly logger = new Logger(OidcLoginController.name)

  constructor(private readonly oidcLoginService: OidcLoginService) {}

  @ApiDoc({ summary: '跳转到身份提供方登录（Pocket ID 等 OIDC）' })
  @Public()
  @Get('login')
  async login(@Query('lng') lng: string | undefined, @Res() res: Response) {
    const language = normalizeLng(lng)
    if (!this.oidcLoginService.enabled) {
      res.status(404).send('OIDC login is not configured')
      return
    }
    try {
      const { url, cookie } = await this.oidcLoginService.createAuthorization(language)
      res.cookie(STATE_COOKIE, cookie, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60 * 1000,
      })
      res.redirect(url)
    }
    catch (error) {
      this.logger.error(error, 'OIDC 登录跳转失败')
      res.redirect(this.oidcLoginService.webUrl(language, `auth/login?oidc_error=${errorCode(error)}`))
    }
  }

  @ApiDoc({ summary: '身份提供方登录回调' })
  @Public()
  @Get('callback')
  async callback(
    @Query() query: { code?: string, state?: string, error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!this.oidcLoginService.enabled) {
      res.status(404).send('OIDC login is not configured')
      return
    }
    const saved = await this.oidcLoginService.readState(req.cookies?.[STATE_COOKIE])
    const language = normalizeLng(saved?.lng)
    res.clearCookie(STATE_COOKIE, { path: '/' })
    try {
      const token = await this.oidcLoginService.completeLogin(query, saved)
      // 凭证放在 # 后面：不会出现在服务器访问日志和 Referer 里
      res.redirect(`${this.oidcLoginService.webUrl(language, 'auth/oidc-callback')}#token=${encodeURIComponent(token)}`)
    }
    catch (error) {
      this.logger.warn(`OIDC 登录失败：${error instanceof Error ? error.message : String(error)}`)
      res.redirect(this.oidcLoginService.webUrl(language, `auth/login?oidc_error=${errorCode(error)}`))
    }
  }
}
