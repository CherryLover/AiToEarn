import type { ConfigOverrideSavedEvent } from '@yikart/config-editor'
import type { FSWatcher } from 'node:fs'
import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { onConfigOverrideSaved } from '@yikart/config-editor'
import { agentConfigSchema, config } from '../../../config'
import { CLAUDE_CODE_ROUTER_PROVIDER_NAME } from '../agent.constants'

interface TransformerConfig {
  use: Array<string | [string, Record<string, unknown>] | Record<string, TransformerConfig>>
}

interface ProviderConfig {
  name: string
  api_base_url: string
  api_key: string
  models: string[]
  transformer?: TransformerConfig
}

interface RouterConfig {
  default: string
  background?: string
  think?: string
  longContext?: string
  longContextThreshold?: number
  webSearch?: string
  image?: string
}

interface ClaudeCodeRouterConfig {
  PORT?: number
  APIKEY?: string
  PROXY_URL?: string
  LOG?: boolean
  LOG_LEVEL?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  HOST?: string
  NON_INTERACTIVE_MODE?: boolean
  Providers?: ProviderConfig[]
  Router?: RouterConfig
  API_TIMEOUT_MS?: number
}

@Injectable()
export class ClaudeCodeRouterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClaudeCodeRouterService.name)
  private childProcess: ChildProcess | null = null
  private fileWatcher: FSWatcher | null = null
  private shouldRestart = true
  private cliPath: string | null = null
  private unsubscribeConfigOverride: (() => void) | null = null
  private readonly sessionDir = join(process.cwd(), '.claude-session')
  private readonly configDir = join(this.sessionDir, '.claude-code-router')
  private readonly configPath = join(this.configDir, 'config.json')
  private readonly pidFilePath = join(this.sessionDir, '.claude-code-router.pid')

  async onModuleInit() {
    const routerConfig = config.agent

    const cliPath = require.resolve('@musistudio/claude-code-router/dist/cli.js')
    this.cliPath = cliPath
    this.logger.debug(`找到 Claude Code Router CLI: ${cliPath}`)

    this.startFileWatcher()
    this.generateConfigFile(routerConfig)
    this.startChildProcess(cliPath)

    // 运行时覆盖层保存完，`agent` 这一段不重启整个 ai 服务就生效：
    // 只重写 router 的 config.json 并重启那个子进程，主进程不动
    this.unsubscribeConfigOverride = onConfigOverrideSaved(event => this.handleConfigOverrideSaved(event))
  }

  async onModuleDestroy() {
    this.shouldRestart = false

    if (this.unsubscribeConfigOverride) {
      this.unsubscribeConfigOverride()
      this.unsubscribeConfigOverride = null
    }

    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
      this.logger.debug('文件监听器已停止')
    }

    if (this.childProcess) {
      this.logger.debug('正在停止 Claude Code Router...')
      this.childProcess.kill('SIGTERM')
      this.childProcess = null
    }
  }

  /**
   * 重新生成 router 配置并重启子进程。主进程不动，所以网页上改完 `agent.baseUrl` / `agent.apiKey`
   * 不需要点「重启服务」。
   *
   * 注意范围：这里只换掉 router 的上游。`agent.models` 那份清单在模块加载时就被
   * `AllowedModelSchema`（`agent.dto.ts`）吃成了 zod 枚举，改模型清单仍然要重启服务才算数。
   */
  reloadAgentConfig(routerConfig: typeof config.agent): void {
    this.generateConfigFile(routerConfig)
    this.restartChildProcess()
  }

  private handleConfigOverrideSaved(event: ConfigOverrideSavedEvent) {
    if (!event.changedKeys.includes('agent')) {
      return
    }

    const parsed = agentConfigSchema.safeParse(event.config['agent'])
    if (!parsed.success) {
      this.logger.warn('保存后的 agent 配置过不了校验，沿用当前 Claude Code Router 配置')
      return
    }

    try {
      this.reloadAgentConfig(parsed.data)
      this.logger.debug('agent 配置有变化，已重写 Claude Code Router 配置并重启子进程')
    }
    catch (error) {
      // 热生效失败不能让「保存配置」这件事失败，配置已经落盘，点一次重启也能生效
      this.logger.error(error, '热更新 Claude Code Router 配置失败')
    }
  }

  private restartChildProcess() {
    if (!this.childProcess) {
      if (this.cliPath) {
        this.startChildProcess(this.cliPath)
      }
      return
    }

    // exit 回调里带着 shouldRestart，杀掉之后会自己用新配置重新拉起来
    this.childProcess.kill('SIGTERM')
  }

  private generateConfigFile(routerConfig: typeof config.agent) {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
      this.logger.debug(`创建配置目录: ${this.configDir}`)
    }

    const routerConfigFile = this.buildConfigFile(routerConfig)

    writeFileSync(this.configPath, JSON.stringify(routerConfigFile, null, 2), 'utf-8')
    this.logger.debug(`配置文件已生成: ${this.configPath}`)
  }

  private buildConfigFile(routerConfig: typeof config.agent): ClaudeCodeRouterConfig {
    return {
      PORT: 3456,
      APIKEY: 'ccr',
      NON_INTERACTIVE_MODE: true,
      Providers: [
        {
          name: CLAUDE_CODE_ROUTER_PROVIDER_NAME,
          api_base_url: routerConfig.baseUrl,
          api_key: routerConfig.apiKey,
          models: routerConfig.models,
          transformer: {
            use: [
              'Anthropic',
            ],
          },
        },
      ],
      Router: {
        default: `${CLAUDE_CODE_ROUTER_PROVIDER_NAME},${routerConfig.defaultModel}`,
        background: `${CLAUDE_CODE_ROUTER_PROVIDER_NAME},${routerConfig.backgroundModel}`,
        think: `${CLAUDE_CODE_ROUTER_PROVIDER_NAME},${routerConfig.thinkModel}`,
      },
    }
  }

  private startChildProcess(cliPath: string) {
    this.logger.debug('正在启动 Claude Code Router 子进程...')

    this.childProcess = spawn('node', [cliPath, 'start'], {
      cwd: this.sessionDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: this.sessionDir,
      },
    })

    this.childProcess.stdout?.on('data', (data) => {
      this.logger.debug(`Claude Code Router stdout: ${data.toString().trim()}`)
    })

    this.childProcess.stderr?.on('data', (data) => {
      this.logger.warn(`Claude Code Router stderr: ${data.toString().trim()}`)
    })

    this.childProcess.on('exit', (code, signal) => {
      if (code !== null) {
        this.logger.debug(`Claude Code Router 进程退出，退出码: ${code}`)
      }
      else if (signal) {
        this.logger.debug(`Claude Code Router 进程被信号终止: ${signal}`)
      }
      this.childProcess = null

      if (this.shouldRestart) {
        this.logger.debug('正在重启 Claude Code Router...')
        this.startChildProcess(cliPath)
      }
    })

    this.childProcess.on('error', (error) => {
      this.logger.error({ error }, 'Claude Code Router 进程错误')
      this.childProcess = null
    })

    this.logger.debug('Claude Code Router 子进程已启动')
  }

  private removePidFile() {
    if (existsSync(this.pidFilePath)) {
      try {
        unlinkSync(this.pidFilePath)
        this.logger.debug(`已删除 pid 文件: ${this.pidFilePath}`)
      }
      catch (error) {
        this.logger.warn({ error }, '删除 pid 文件失败')
      }
    }
  }

  private startFileWatcher() {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
      this.logger.debug(`创建配置目录: ${this.configDir}`)
    }

    if (this.fileWatcher) {
      this.fileWatcher.close()
    }

    this.removePidFile()

    this.logger.debug(`开始监听目录: ${this.sessionDir}`)

    this.fileWatcher = watch(this.sessionDir, (eventType, filename) => {
      if (filename === '.claude-code-router.pid') {
        this.logger.debug(`检测到 pid 文件事件: ${eventType}`)
        this.removePidFile()
      }
    })

    this.fileWatcher.on('error', (error) => {
      this.logger.error({ error }, '文件监听器错误')
    })
  }
}
