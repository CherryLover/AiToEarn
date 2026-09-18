import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { DeviceDoc, DevicesService } from './devices.service'

/** 请求上挂设备的字段名，跟登录用户的 request.user 分开 */
export const DEVICE_REQUEST_KEY = 'device'

/** 从 Authorization: Bearer <token> 里取令牌，WebSocket 握手也复用这个 */
export function extractBearerToken(headers: Record<string, unknown>): string | undefined {
  const raw = headers['authorization']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string')
    return undefined

  const [type, token] = value.split(' ')
  return type === 'Bearer' && token ? token : undefined
}

/**
 * 设备令牌守卫。
 *
 * 做法照 core/api-key：明文令牌只在配对时给一次，库里存 sha1 哈希，
 * 每次请求拿明文算哈希去查。查不到就是无效（吊销过的也查不到）。
 *
 * 用法：控制器上同时挂 @Public()（让全局的登录守卫放行，它认的是 JWT）
 * 和 @UseGuards(DeviceAuthGuard)。全局守卫先跑，这个后跑。
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly devicesService: DevicesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token = extractBearerToken(request.headers ?? {})

    if (!token)
      throw new AppException(ResponseCode.DeviceTokenMissing)

    request[DEVICE_REQUEST_KEY] = await this.devicesService.authenticateToken(token)
    return true
  }
}

/** 取当前请求的设备，等价于登录接口里的 @GetToken() */
export const GetDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeviceDoc => {
    const request = ctx.switchToHttp().getRequest()
    return request[DEVICE_REQUEST_KEY]
  },
)
