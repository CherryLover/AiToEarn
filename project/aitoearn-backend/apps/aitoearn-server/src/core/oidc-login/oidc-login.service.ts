import { createHash, randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { UserRepository, UserStatus, UserType } from '@yikart/mongodb'
import { config } from '../../config'

interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
}

interface LoginState {
  state: string
  nonce: string
  verifier: string
  lng: string
}

interface IdTokenClaims {
  iss?: string
  aud?: string | string[]
  exp?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
}

/** 登录失败的原因码，会原样带回网页登录页展示 */
export class OidcLoginError extends Error {
  constructor(readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000

function base64url(buf: Buffer) {
  return buf.toString('base64url')
}

@Injectable()
export class OidcLoginService {
  private readonly logger = new Logger(OidcLoginService.name)
  private discovery?: { value: OidcDiscovery, expiresAt: number }

  constructor(
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
  ) {}

  get enabled() {
    return !!config.oidcLogin
  }

  private get options() {
    if (!config.oidcLogin) {
      throw new OidcLoginError('oidc_disabled')
    }
    return config.oidcLogin
  }

  /** 登录过程中的临时状态用单独派生的密钥签名，不能被当成登录凭证 */
  private get stateSecret() {
    return `${config.auth.secret}:oidc-login-state`
  }

  webUrl(lng: string, path: string) {
    const base = this.options.webBaseUrl.replace(/\/+$/, '')
    return `${base}/${lng}/${path}`
  }

  private async getDiscovery(): Promise<OidcDiscovery> {
    if (this.discovery && this.discovery.expiresAt > Date.now()) {
      return this.discovery.value
    }
    const issuer = this.options.issuer.replace(/\/+$/, '')
    const res = await fetch(`${issuer}/.well-known/openid-configuration`)
    if (!res.ok) {
      throw new OidcLoginError('discovery_failed', `HTTP ${res.status}`)
    }
    const value = await res.json() as OidcDiscovery
    this.discovery = { value, expiresAt: Date.now() + DISCOVERY_TTL_MS }
    return value
  }

  /** 生成跳转到身份提供方的地址，以及要写进 cookie 的临时状态 */
  async createAuthorization(lng: string) {
    const options = this.options
    const discovery = await this.getDiscovery()

    const state = base64url(randomBytes(24))
    const nonce = base64url(randomBytes(24))
    const verifier = base64url(randomBytes(48))
    const challenge = base64url(createHash('sha256').update(verifier).digest())

    const url = new URL(discovery.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', options.clientId)
    url.searchParams.set('redirect_uri', options.redirectUri)
    url.searchParams.set('scope', options.scopes)
    url.searchParams.set('state', state)
    url.searchParams.set('nonce', nonce)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')

    const payload: LoginState = { state, nonce, verifier, lng }
    const cookie = await this.jwtService.signAsync(payload, { secret: this.stateSecret, expiresIn: '10m' })
    return { url: url.toString(), cookie }
  }

  async readState(cookie: string | undefined): Promise<LoginState | undefined> {
    if (!cookie) {
      return undefined
    }
    try {
      return await this.jwtService.verifyAsync<LoginState>(cookie, { secret: this.stateSecret })
    }
    catch {
      return undefined
    }
  }

  /** 处理回调：校验 → 换令牌 → 核对邮箱 → 找到或新建用户 → 签发和自动登录同格式的凭证 */
  async completeLogin(
    query: { code?: string, state?: string, error?: string },
    saved: LoginState | undefined,
  ): Promise<string> {
    if (query.error) {
      throw new OidcLoginError('idp_error', query.error)
    }
    if (!saved) {
      throw new OidcLoginError('state_expired')
    }
    if (!query.state || query.state !== saved.state) {
      throw new OidcLoginError('state_mismatch')
    }
    if (!query.code) {
      throw new OidcLoginError('code_missing')
    }

    const options = this.options
    const discovery = await this.getDiscovery()

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      code_verifier: saved.verifier,
    })
    if (options.clientSecret) {
      body.set('client_secret', options.clientSecret)
    }
    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body,
    })
    if (!tokenRes.ok) {
      const text = (await tokenRes.text()).slice(0, 300)
      throw new OidcLoginError('token_exchange_failed', `HTTP ${tokenRes.status} ${text}`)
    }
    const tokens = await tokenRes.json() as { id_token?: string, access_token?: string }
    if (!tokens.id_token) {
      throw new OidcLoginError('id_token_missing')
    }

    // ID Token 是服务端直接从令牌接口经 TLS 取回的，按 OIDC Core 3.1.3.7 可用 TLS 代替验签，这里只校验声明
    const claims = this.decodeClaims(tokens.id_token)
    const issuer = (value?: string) => (value ?? '').replace(/\/+$/, '')
    if (issuer(claims.iss) !== issuer(discovery.issuer)) {
      throw new OidcLoginError('issuer_mismatch')
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audiences.includes(options.clientId)) {
      throw new OidcLoginError('audience_mismatch')
    }
    if (claims.nonce !== saved.nonce) {
      throw new OidcLoginError('nonce_mismatch')
    }
    if (!claims.exp || claims.exp * 1000 < Date.now()) {
      throw new OidcLoginError('id_token_expired')
    }

    let { email, email_verified: emailVerified, name } = claims
    if (!email && discovery.userinfo_endpoint && tokens.access_token) {
      const infoRes = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (infoRes.ok) {
        const info = await infoRes.json() as IdTokenClaims
        email = info.email
        emailVerified = info.email_verified
        name = name ?? info.name ?? info.preferred_username
      }
    }
    if (!email) {
      throw new OidcLoginError('email_missing')
    }
    if (emailVerified === false) {
      throw new OidcLoginError('email_unverified')
    }

    const mail = email.trim().toLowerCase()
    const allowed = options.allowedEmails.map(item => item.trim().toLowerCase())
    if (!allowed.includes(mail)) {
      throw new OidcLoginError('email_not_allowed', mail)
    }

    let user = await this.userRepository.getByMail(mail)
    if (!user) {
      user = await this.userRepository.create({
        name: name || claims.preferred_username || mail.split('@')[0],
        mail,
        status: UserStatus.OPEN,
        userType: UserType.CREATOR,
        isDelete: false,
        usedStorage: 0,
        storage: { total: 500 * 1024 * 1024 },
        locale: saved.lng.startsWith('zh') ? 'zh-CN' : 'en-US',
      })
      this.logger.log(`OIDC 首次登录，已建用户 ${mail}`)
    }
    if (user.status !== UserStatus.OPEN) {
      throw new OidcLoginError('user_disabled')
    }

    const userId = String(user.id ?? (user as { _id?: unknown })._id)
    return await this.jwtService.signAsync(
      { id: userId, mail: user.mail, name: user.name },
      { secret: config.auth.secret, expiresIn: options.tokenExpiresIn as never },
    )
  }

  private decodeClaims(idToken: string): IdTokenClaims {
    const part = idToken.split('.')[1]
    if (!part) {
      throw new OidcLoginError('id_token_invalid')
    }
    try {
      return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as IdTokenClaims
    }
    catch {
      throw new OidcLoginError('id_token_invalid')
    }
  }
}
