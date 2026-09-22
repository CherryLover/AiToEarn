import type { ZodDto } from '@yikart/common'
import type { ZodType } from 'zod'
import { AppException, resolveConfigOverridePath, ResponseCode } from '@yikart/common'

interface ConfigEditorSourceConfig {
  meta?: {
    configPath?: string
    overridePath?: string
  }
}

export interface ConfigEditorModuleOptions<T> {
  schema: ZodDto<T, any> | ZodType
  config: ConfigEditorSourceConfig
  routePrefix?: string
}

export class ConfigEditorConfig<T> {
  schema: ZodDto<T, any> | ZodType
  /** 基础配置文件（`.env` 渲染出来的基石），只读，任何时候都不写 */
  configPath: string
  /** 运行时覆盖文件，保存配置只写这一个文件 */
  overridePath: string
  routePrefix: string

  constructor(options: ConfigEditorModuleOptions<T>) {
    const configPath = options.config.meta?.configPath
    if (!configPath) {
      throw new AppException(ResponseCode.ConfigEditorConfigPathMissing)
    }

    this.schema = options.schema
    this.configPath = configPath
    this.overridePath = options.config.meta?.overridePath ?? resolveConfigOverridePath(configPath)
    this.routePrefix = (options.routePrefix ?? 'config').replace(/^\/+|\/+$/g, '') || 'config'
  }
}
