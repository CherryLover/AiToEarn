import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import {
  AppException,
  assertNoProtectedConfigPaths,
  collectConfigLeafPaths,
  diffConfigOverride,
  diffTopLevelKeys,
  getConfigOverrideFormat,
  isZodDto,
  listProtectedConfigPaths,
  mergeConfigOverride,
  parseConfigOverrideContent,
  ResponseCode,
} from '@yikart/common'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { ConfigEditorConfig } from './config-editor.config'
import { ConfigFileFormat } from './config-editor.vo'
import { emitConfigOverrideSaved } from './config-override.events'

interface ConfigLayers {
  format: ConfigFileFormat
  /** 基础配置文件里原样解析出来的值 */
  baseValue: Record<string, unknown>
  /** 覆盖文件里原样解析出来的值，文件不存在就是 {} */
  overrideValue: Record<string, unknown>
}

@Injectable()
export class ConfigEditorService {
  private readonly logger = new Logger(ConfigEditorService.name)

  constructor(
    private readonly config: ConfigEditorConfig<unknown>,
  ) {}

  /** 返回**合并后**的配置，外加哪些键路径来自覆盖层、哪些顶层键根本不让改 */
  async getConfig() {
    const { format, baseValue, overrideValue } = await this.readLayers()
    const merged = Object.keys(overrideValue).length > 0
      ? this.validateMergedConfig(mergeConfigOverride(baseValue, overrideValue))
      : this.validateConfigValue(baseValue)
    return {
      config: merged,
      format,
      overriddenPaths: collectConfigLeafPaths(overrideValue),
      protectedPaths: listProtectedConfigPaths(merged),
    }
  }

  /** 校验：schema 过不过 + 有没有动到只能从 `.env` 改的「基石」配置 */
  async validateConfig(config: Record<string, unknown>) {
    await this.prepareOverride(config)
  }

  /**
   * 保存：只把**与基础配置不同的部分**写进覆盖文件，基础配置一个字节都不碰。
   *
   * 基础配置是 `.env` 渲染出来、只读挂进容器的，写它必然失败；就算写成功，下次部署也会被重新渲染覆盖。
   */
  async saveConfig(config: Record<string, unknown>) {
    const { format, baseValue, overrideValue, override, merged } = await this.prepareOverride(config)

    const previousMerged = this.tryValidateConfigValue(mergeConfigOverride(baseValue, overrideValue))
    await this.writeOverrideFile(this.serializeConfig(override, format))

    this.notifyOverrideSaved(merged, diffTopLevelKeys(previousMerged, merged))
  }

  /**
   * 把提交上来的整份配置折成覆盖层：
   * 1. 提交值先过一遍 schema
   * 2. 基础配置也过一遍 schema，让默认值补齐之后再做 diff——否则用户压根没动过、
   *    只是被 zod 默认值填出来的字段会被当成差异冻进覆盖层，以后改 `.env` 就改不动了
   * 3. diff 里出现受保护顶层键直接拒绝，并逐个列出违规的键路径
   * 4. 合并回去再校验一次，兜住「diff 单独看没问题、合上去反而不合法」
   */
  private async prepareOverride(config: Record<string, unknown>) {
    const { format, baseValue, overrideValue } = await this.readLayers()
    const submitted = this.validateConfigValue(config)
    const baseConfig = this.validateConfigValue(baseValue)

    const override = diffConfigOverride(baseConfig, submitted)
    assertNoProtectedConfigPaths(override)

    const merged = this.validateMergedConfig(mergeConfigOverride(baseValue, override))

    return { format, baseValue, overrideValue, override, merged }
  }

  private notifyOverrideSaved(config: Record<string, unknown>, changedKeys: string[]) {
    if (changedKeys.length === 0) {
      return
    }
    try {
      emitConfigOverrideSaved({ config, changedKeys })
    }
    catch (error) {
      // 热生效是旁支：订阅方炸了不能把「保存成功」变成「保存失败」，配置已经落盘了
      this.logger.warn(error, '运行时覆盖保存事件的订阅方抛异常')
    }
  }

  private async readLayers(): Promise<ConfigLayers> {
    const configPath = resolve(process.cwd(), this.config.configPath)
    const format = this.getConfigFileFormat(configPath)
    const baseValue = this.parseConfig(await this.readConfigFile(configPath), format)
    const overrideValue = await this.readOverrideFile()
    return { format, baseValue, overrideValue }
  }

  private getConfigFileFormat(filePath: string): ConfigFileFormat {
    const lowerPath = filePath.toLowerCase()
    if (lowerPath.endsWith('.json')) {
      return ConfigFileFormat.Json
    }
    if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) {
      return ConfigFileFormat.Yaml
    }
    throw new AppException(ResponseCode.ConfigEditorUnsupportedFormat)
  }

  private parseConfig(content: string, format: ConfigFileFormat): Record<string, unknown> {
    try {
      const parsed = format === ConfigFileFormat.Json
        ? JSON.parse(content)
        : parseYaml(content)
      return (parsed ?? {}) as Record<string, unknown>
    }
    catch (error) {
      throw new AppException(
        ResponseCode.ConfigEditorParseFailed,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private getSchema(): z.ZodType {
    const schema = isZodDto(this.config.schema) ? this.config.schema.schema : this.config.schema
    if (!(schema instanceof z.ZodType)) {
      throw new AppException(ResponseCode.ConfigEditorValidationFailed)
    }
    return schema
  }

  private validateConfigValue(config: unknown): Record<string, unknown> {
    const result = this.getSchema().safeParse(config)
    if (!result.success) {
      throw new AppException(ResponseCode.ConfigEditorValidationFailed, z.prettifyError(result.error))
    }
    return result.data as Record<string, unknown>
  }

  private validateMergedConfig(config: unknown): Record<string, unknown> {
    const result = this.getSchema().safeParse(config)
    if (!result.success) {
      throw new AppException(ResponseCode.ConfigOverrideInvalid, { reason: z.prettifyError(result.error) })
    }
    return result.data as Record<string, unknown>
  }

  /** 尽量校验一次好拿到默认值补齐后的形态；现有覆盖文件本身就不合法时退回原始合并结果 */
  private tryValidateConfigValue(config: Record<string, unknown>): Record<string, unknown> {
    const result = this.getSchema().safeParse(config)
    return result.success ? result.data as Record<string, unknown> : config
  }

  private serializeConfig(config: Record<string, unknown>, format: ConfigFileFormat) {
    if (format === ConfigFileFormat.Json) {
      return `${JSON.stringify(config, null, 2)}\n`
    }
    return stringifyYaml(config)
  }

  private async readConfigFile(configPath: string) {
    try {
      return await readFile(configPath, 'utf-8')
    }
    catch (error) {
      throw new AppException(
        ResponseCode.ConfigEditorReadFailed,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /** 覆盖文件不存在不算失败：等于完全没有覆盖层，读到的就是基础配置 */
  private async readOverrideFile(): Promise<Record<string, unknown>> {
    const overridePath = resolve(process.cwd(), this.config.overridePath)
    const format = getConfigOverrideFormat(overridePath)

    let content: string
    try {
      content = await readFile(overridePath, 'utf-8')
    }
    catch (error) {
      // ENOENT：还没存过覆盖层。EISDIR：compose 单文件挂载时宿主机文件缺失，Docker 建成了目录
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EISDIR') {
        return {}
      }
      throw new AppException(ResponseCode.ConfigOverrideReadFailed, {
        path: overridePath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }

    return parseConfigOverrideContent(content, format)
  }

  private async writeOverrideFile(content: string) {
    const overridePath = resolve(process.cwd(), this.config.overridePath)
    try {
      // 覆盖层里会有 Key，新建时就按 600 来
      await writeFile(overridePath, content, { encoding: 'utf-8', mode: 0o600 })
    }
    catch (error) {
      throw new AppException(ResponseCode.ConfigOverrideWriteFailed, {
        path: overridePath,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
