import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { OidcLoginController } from './oidc-login.controller'
import { OidcLoginService } from './oidc-login.service'

/** 用 OIDC（Pocket ID 等）登录，替代开源版把管理员凭证写进网页的自动登录 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [OidcLoginController],
  providers: [OidcLoginService],
})
export class OidcLoginModule {}
