import { createZodDto } from '@yikart/common'
import { z } from 'zod'

export enum ConfigFileFormat {
  Json = 'json',
  Yaml = 'yaml',
}

export const ConfigEditorConfigVoSchema = z.object({
  config: z.record(z.string(), z.unknown()).describe('合并后的配置对象：基础配置叠上运行时覆盖层'),
  format: z.enum(ConfigFileFormat).describe('配置文件格式'),
  overriddenPaths: z.array(z.string()).describe('来自运行时覆盖层的键路径，形如 agent.baseUrl'),
  protectedPaths: z.array(z.string()).describe('只能从部署环境改的顶层键，形如 auth、mongodb'),
})

export class ConfigEditorConfigVo extends createZodDto(ConfigEditorConfigVoSchema, 'ConfigEditorConfigVo') {}
