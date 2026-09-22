import type { ZodDto } from './zod-dto.util'
import { resolve } from 'node:path'
import { program } from 'commander'
import { fileLoader, selectConfig as nestSelectConfig, TypedConfigModule } from 'nest-typed-config'
import { z } from 'zod'
import {
  findProtectedConfigPaths,
  mergeConfigOverride,
  readConfigOverrideFileSync,
  resolveConfigOverridePath,
} from './config-override.util'
import { zodValidate } from './zod-validate.util'

export interface SelectedConfigMeta {
  /** `-c` 传进来的基础配置文件路径 */
  configPath: string
  /** 运行时覆盖文件路径，由 configPath 推导，文件可以不存在 */
  overridePath: string
}

/**
 * 启动期读覆盖层。这里刻意抛普通 Error 而不是 AppException：
 * 这一刻还没有 HTTP 上下文，容器起不来时人看到的就是这条日志，得能直接照着改文件。
 * 覆盖文件不存在时返回 `{}`，一切照旧。
 */
function loadConfigOverride(overridePath: string): Record<string, unknown> {
  let override: Record<string, unknown>
  try {
    override = readConfigOverrideFileSync(overridePath)
  }
  catch (error) {
    throw new Error(
      `Runtime config override is not readable: ${overridePath}\n${error instanceof Error ? error.message : String(error)}\n`,
    )
  }

  // 受保护的「基石」键只能从 .env 走，手写进覆盖文件的一样拒绝，并且指名道姓说是哪几个键
  const protectedPaths = findProtectedConfigPaths(override)
  if (protectedPaths.length > 0) {
    throw new Error(
      `Runtime config override ${overridePath} touches keys that can only be set from the deployment environment:\n${
        protectedPaths.map(path => `  - ${path}`).join('\n')}\n`,
    )
  }

  return override
}

export function selectConfig<
  TOutput = unknown,
  TInput = TOutput,
>(config: ZodDto<TOutput, TInput>): TOutput & { meta: SelectedConfigMeta } {
  const configPath = resolve(
    process.cwd(),
    program
      .requiredOption('-c --config <config>', 'config path')
      .parse(process.argv)
      .opts()['config'],
  )
  const overridePath = resolveConfigOverridePath(configPath)
  const loadBaseConfig = fileLoader({ absolutePath: configPath })
  // 覆盖文件不存在时这里拿到的是 {}，深合并的结果等于基础配置本身，行为和没有覆盖层完全一致
  let hasOverride = false

  const module = TypedConfigModule.forRoot({
    schema: config,
    validate(value) {
      return zodValidate<TOutput, TInput>(value as TInput, config, (error) => {
        const hint = hasOverride
          ? `\nRuntime override in use: ${overridePath}\n`
          : ''
        return new Error(`Configuration is not valid:\n${z.prettifyError(error)}\n${hint}`)
      }) as Record<string, unknown>
    },
    load: () => {
      const base = loadBaseConfig()
      const override = loadConfigOverride(overridePath)
      hasOverride = Object.keys(override).length > 0
      return mergeConfigOverride(base, override)
    },
  })
  const selectedConfig = nestSelectConfig(module, config)
  Object.defineProperty(selectedConfig, 'meta', {
    value: { configPath, overridePath } satisfies SelectedConfigMeta,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return selectedConfig as TOutput & { meta: SelectedConfigMeta }
}
