import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { AitoearnAiClientService, ReadinessItemResponse } from '@yikart/aitoearn-ai-client'
import { StorageProvider } from '@yikart/assets'
import { ResponseCode } from '@yikart/common'
import { config } from '../../config'
import { sanitizeDetail } from './readiness.sanitize'

export type ReadinessStatus = 'ok' | 'missing' | 'error'

export interface ReadinessItem {
  key: string
  status: ReadinessStatus
  required: boolean
  configPath: string | null
  detail: string | null
}

export interface ReadinessResult {
  ready: boolean
  items: ReadinessItem[]
}

/** 探对象存储用的 key：一个不存在的路径，只借它走一趟完整的签名 + 请求 */
const ASSETS_PROBE_KEY = 'readiness-probe/.probe'

/** ai 侧负责的检查项，以及它们在 server 这边的兜底定义（ai 挂了也得有一条结果） */
const AI_SIDE_ITEMS: { key: string, configPath: string, required: boolean }[] = [
  { key: 'agentUpstream', configPath: 'agent.baseUrl', required: true },
  { key: 'aiChatModels', configPath: 'ai.models.chat', required: true },
]

/**
 * 就绪检查（contract-runtime-config 4.1）。
 *
 * 起因是线上「让 AI 提炼方向」一直报错，根因是 `agent.*` 的上游从来没被部署配置覆盖过，
 * 一直躺着仓库里的占位值——而这件事在网页上完全看不出来。这个接口就是让它看得出来。
 *
 * 三条硬规矩：
 * 1. **一项都不抛错**：每一项各跑各的，探不通就回 `error` + `detail`；
 * 2. **不影响任何主流程**：只读、只探，不写任何业务数据；
 * 3. **detail 里绝不出现 Key**：所有对外文字统一过 `sanitizeDetail`，日志同理。
 *
 * `agentUpstream` 和 `aiChatModels` 读的是 ai 那边的配置（`agent.*`、`ai.*`），
 * server 进程里根本读不到，所以这两项走 ai 的 `GET /internal/readiness`；
 * 其余三项的配置都在 server 自己手上，就地判。
 */
@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name)

  constructor(
    private readonly aiClientService: AitoearnAiClientService,
    private readonly storageProvider: StorageProvider,
  ) {}

  async getReadiness(): Promise<ReadinessResult> {
    const [aiSideItems, assets, projectsRoot, notify] = await Promise.all([
      this.listAiSideItems(),
      this.checkSafely('assets', 'assets', true, () => this.checkAssets()),
      this.checkSafely('projectsRoot', 'projects.root', true, () => this.checkProjectsRoot()),
      this.checkSafely('notify', 'notify', false, () => this.checkNotify()),
    ])

    const items = [...aiSideItems, assets, projectsRoot, notify]
    const ready = items.every(item => !item.required || item.status === 'ok')

    return { ready, items }
  }

  /** 单项探测炸了也要出一条结果，不能把整个接口带崩 */
  private async checkSafely(
    key: string,
    configPath: string,
    required: boolean,
    check: () => ReadinessItem | Promise<ReadinessItem>,
  ): Promise<ReadinessItem> {
    try {
      return await check()
    }
    catch (error) {
      this.logger.warn(
        error as Error,
        `就绪检查项 ${key} 探测时自身出错 code=${ResponseCode.SystemReadinessProbeFailed}`,
      )
      return {
        key,
        status: 'error',
        required,
        configPath,
        detail: `检查这一项的时候自己出错了：${sanitizeDetail(error, this.secrets())}`,
      }
    }
  }

  /** server 自己配置里的明文 Key，清洗 detail 时整串抹掉 */
  private secrets(): string[] {
    const assets = config.assets as unknown as Record<string, unknown>
    const candidates: unknown[] = [
      assets?.['accessKeyId'],
      assets?.['secretAccessKey'],
      assets?.['accessKeySecret'],
      config.notify?.barkKey,
      config.aiClient?.token,
    ]
    return candidates.filter((value): value is string => typeof value === 'string' && value.length > 0)
  }

  /**
   * 问 ai 要它那边能判的项。
   *
   * ai 连不上是常态之一（容器还没起来、内部 token 配错），**必须接住**：
   * 每一项都退化成 `error`，整个接口照样 200。
   */
  private async listAiSideItems(): Promise<ReadinessItem[]> {
    let responseItems: ReadinessItemResponse[]
    try {
      const response = await this.aiClientService.ai.getReadiness()
      responseItems = response?.items ?? []
    }
    catch (error) {
      this.logger.warn(
        error as Error,
        `ai 服务的就绪检查接口调不通 code=${ResponseCode.SystemReadinessUpstreamUnreachable}`,
      )
      const detail = `AI 服务的内部接口调不通：${sanitizeDetail(error, this.secrets())}`
      return AI_SIDE_ITEMS.map(item => ({
        key: item.key,
        status: 'error' as const,
        required: item.required,
        configPath: item.configPath,
        detail,
      }))
    }

    return AI_SIDE_ITEMS.map((expected) => {
      const found = responseItems.find(item => item?.key === expected.key)
      if (!found) {
        return {
          key: expected.key,
          status: 'error' as const,
          required: expected.required,
          configPath: expected.configPath,
          detail: 'AI 服务没有返回这一项的检查结果',
        }
      }
      return {
        key: expected.key,
        // required 以 server 这边的定义为准：拦不拦人是本服务说了算
        required: expected.required,
        status: found.status,
        configPath: found.configPath ?? expected.configPath,
        // ai 那边已经洗过一遍，这里再洗一遍：detail 是要端到网页上的
        detail: found.detail ? sanitizeDetail(found.detail, this.secrets()) : null,
      }
    })
  }

  /**
   * 对象存储：拿一个不存在的 key 走一趟 head。
   *
   * 「对象不存在」说明请求发出去了、签名也认了，这就够了——
   * 桶列不动、Key 不对、endpoint 写错，都会以别的错误形态冒出来。
   */
  private async checkAssets(): Promise<ReadinessItem> {
    try {
      await this.storageProvider.headObject(ASSETS_PROBE_KEY)
      return { key: 'assets', status: 'ok', required: true, configPath: 'assets', detail: null }
    }
    catch (error) {
      if (isObjectNotFound(error)) {
        return { key: 'assets', status: 'ok', required: true, configPath: 'assets', detail: null }
      }
      this.logger.warn(
        error as Error,
        `对象存储探测失败 code=${ResponseCode.SystemReadinessUpstreamUnreachable}`,
      )
      return {
        key: 'assets',
        status: 'error',
        required: true,
        configPath: 'assets',
        detail: `对象存储连不上或者没认这把 Key：${sanitizeDetail(error, this.secrets())}`,
      }
    }
  }

  /** 物料根目录：存在、是目录、能写 */
  private async checkProjectsRoot(): Promise<ReadinessItem> {
    const root = path.resolve(config.projects.root)

    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(root)
    }
    catch {
      return {
        key: 'projectsRoot',
        status: 'missing',
        required: true,
        configPath: 'projects.root',
        detail: `物料根目录不存在：${root}（容器里要把数据盘挂到这个路径上）`,
      }
    }

    if (!stats.isDirectory()) {
      return {
        key: 'projectsRoot',
        status: 'error',
        required: true,
        configPath: 'projects.root',
        detail: `物料根目录不是一个目录：${root}`,
      }
    }

    try {
      await access(root, constants.W_OK)
    }
    catch {
      return {
        key: 'projectsRoot',
        status: 'error',
        required: true,
        configPath: 'projects.root',
        detail: `物料根目录不可写：${root}（检查挂载是不是挂成了只读，以及容器里跑的用户有没有写权限）`,
      }
    }

    return { key: 'projectsRoot', status: 'ok', required: true, configPath: 'projects.root', detail: null }
  }

  /**
   * 推送通道：没配就是 `missing`（不拦人），配齐了就是 `ok`。
   *
   * 只看配置齐不齐，**不真发一条**。真探活在设置页那个「发送测试通知」按钮上，
   * 那是人主动点的。就绪检查是进站自动跑的，让它顺手往人手机上推一条，
   * 等于每开一次网页震一下——比没配推送还烦。
   */
  private checkNotify(): ReadinessItem {
    const notify = config.notify
    if (!notify?.enabled || !notify.barkUrl || !notify.barkKey) {
      return {
        key: 'notify',
        status: 'missing',
        required: false,
        configPath: 'notify',
        detail: '没配推送通道，草稿生成完、有工单要人工发的时候不会有提醒',
      }
    }

    return { key: 'notify', status: 'ok', required: false, configPath: 'notify', detail: null }
  }
}

/**
 * 判断是不是「对象不存在」。
 *
 * S3 走 `$metadata.httpStatusCode`，阿里云 OSS 走 `status` + `code`，
 * 两边的错误形状不一样，所以按形状逐个认，不认识的一律当成真失败。
 */
function isObjectNotFound(error: unknown): boolean {
  if (error == null || typeof error !== 'object')
    return false

  const candidate = error as {
    name?: string
    code?: string
    status?: number
    statusCode?: number
    $metadata?: { httpStatusCode?: number }
  }

  const httpStatus = candidate.$metadata?.httpStatusCode ?? candidate.statusCode ?? candidate.status
  if (httpStatus === 404)
    return true

  return /notfound|nosuchkey/i.test(`${candidate.name ?? ''} ${candidate.code ?? ''}`)
}
