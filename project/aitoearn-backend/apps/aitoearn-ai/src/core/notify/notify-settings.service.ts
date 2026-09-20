import type { NotifyRule } from '@yikart/mongodb'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { NotifyRuleType, UserNotifySettingRepository } from '@yikart/mongodb'
import { config } from '../../config'

/**
 * 规则类型枚举从 `libs/mongodb` 里的 schema 导出（表结构说了算），
 * 这里转出一手：AI 服务内部只从 notify 模块拿，不用到处 import 数据库包。
 */
export { NotifyRuleType }

/**
 * 推送配置从哪儿来（contract-settings 第五节，**这一版是改过的，别照老印象读**）。
 *
 * 顺序固定：
 * 1. **用户把总开关 `enabled` 关掉 → 彻底不推**，`.env` 兜底通道也不走
 * 2. 总开关开着但地址没填齐 → 退回服务器 `.env` 的默认值
 * 3. 两边都没有 → 静默跳过（阶段 4 的既有行为，不能变）
 *
 * 第 1 条是踩过坑才写死的：初版契约写「用户没配**或没开**就退回 .env」，
 * 照字面实现的结果是用户把总开关关了还在继续收通知。关了就该不收。
 */

export interface NotifyUserRef {
  userId: string
  userType: UserType
}

/** 推送真正要用的一组值 */
export interface ResolvedNotifySettings {
  barkUrl: string
  barkKey: string
  group: string
  /**
   * 这组值是谁填的。
   *
   * `user` 的地址要过 SSRF 校验（用户能填任意地址）；
   * `env` 的地址是运维填进服务器 `.env` 的，可能本来就是内网自建的 Bark，不做内网拦截。
   */
  source: 'user' | 'env'
  /**
   * 用户配的通知规则。空数组 = 都开着（和 `UserNotifySetting` schema 的约定一致）。
   *
   * **注意规则和凭据是分开取的**：用户只是没把自己的地址填齐、推送退回 `.env` 兜底通道时，
   * 他配的规则依然算数。不这么做的话，走兜底通道就等于把用户关掉的规则重新打开。
   *
   * （总开关是另一回事：关掉就直接返回 null，根本走不到这里。）
   */
  rules: NotifyRule[]
}

/** `.env` 渲染进来的那份兜底配置长什么样（字段见 `notify.config.ts`） */
interface RawNotifyConfig {
  enabled?: boolean
  barkUrl?: string
  barkKey?: string
  group?: string
}

const DEFAULT_NOTIFY_GROUP = 'AiToEarn'

/**
 * `.env` 兜底配置：总开关、地址、key 少一样都当没配。
 *
 * 返回 null 表示「兜底通道也没有」。
 */
export function resolveEnvNotifySettings(raw?: RawNotifyConfig | null): ResolvedNotifySettings | null {
  if (!raw?.enabled || !raw.barkUrl || !raw.barkKey)
    return null

  return {
    barkUrl: raw.barkUrl,
    barkKey: raw.barkKey,
    group: raw.group || DEFAULT_NOTIFY_GROUP,
    source: 'env',
    rules: [],
  }
}

/** 库里那条配置（只取推送要用的字段，别的不关心） */
export interface UserNotifySettingLike {
  enabled?: boolean
  barkBaseUrl?: string
  barkKey?: string
  group?: string
  rules?: NotifyRule[] | null
}

/**
 * 把「用户那条配置」和「`.env` 兜底」合成最终要用的一组值。
 *
 * - **用户存过配置、但总开关是关的 → 返回 null，一条都不推。**
 *   库里有这条记录就说明是他自己在设置页存下来的，不是默认值；
 *   这时候还拿运维配的兜底通道替他推，等于「关了开关照样收通知」
 * - 总开关开着 + 地址和 key 齐了 → 用用户自己的通道
 * - 总开关开着但地址没填齐 → 退回兜底，规则仍以用户那条配置为准
 * - 用户压根没存过配置 → 退回兜底（阶段 4 的行为，没动）
 */
export function mergeNotifySettings(
  doc: UserNotifySettingLike | null | undefined,
  envFallback: ResolvedNotifySettings | null,
): ResolvedNotifySettings | null {
  if (doc && !doc.enabled)
    return null

  const rules = doc?.rules ?? []

  if (doc?.enabled && doc.barkBaseUrl && doc.barkKey) {
    return {
      barkUrl: doc.barkBaseUrl,
      barkKey: doc.barkKey,
      group: doc.group || DEFAULT_NOTIFY_GROUP,
      source: 'user',
      rules,
    }
  }

  if (!envFallback)
    return null

  return { ...envFallback, rules }
}

/**
 * 这条规则现在开着吗。
 *
 * 规则数组里没出现过的类型**当作开着**：阶段 4 的行为是「配了就推」，
 * 新加规则类型时老数据里不会有那一条，默认关掉等于悄悄把已有的推送停了。
 */
export function isNotifyRuleEnabled(settings: ResolvedNotifySettings, type: NotifyRuleType): boolean {
  const rule = settings.rules.find(item => item?.type === type)
  return rule ? rule.enabled !== false : true
}

/**
 * 读用户的通知配置。
 *
 * 表和仓储都在 `libs/mongodb` 里（`userNotifySetting` 集合，schema 见
 * `libs/mongodb/src/schemas/user-notify-setting.schema.ts`），`MongodbModule` 是 `@Global` 的，
 * AI 服务这边直接注入仓储就能读，不用自己再连一次库、也不用自己再声明一遍字段。
 *
 * 仓储标了 `@Optional()`：单元测试里可以不带库直接 new 出来，
 * 那种情况下只走 `.env` 兜底，行为和阶段 4 完全一样。
 */
@Injectable()
export class NotifySettingsService {
  private readonly logger = new Logger(NotifySettingsService.name)

  constructor(
    @Optional() private readonly userNotifySettingRepo?: UserNotifySettingRepository,
  ) {}

  async resolve(user?: NotifyUserRef): Promise<ResolvedNotifySettings | null> {
    const doc = await this.readUserSetting(user)
    return mergeNotifySettings(doc, resolveEnvNotifySettings(config.notify))
  }

  private async readUserSetting(user?: NotifyUserRef): Promise<UserNotifySettingLike | null> {
    if (!user?.userId || !this.userNotifySettingRepo)
      return null

    try {
      return await this.userNotifySettingRepo.getByUserId(user.userId, user.userType ?? UserType.User)
    }
    catch (error) {
      // 查配置失败不能把主流程带崩，也不能让调用方等在这儿：退回 .env 兜底就是了
      // 同样不把 error 交给 logger：mongo 的报错文本里带连接串和主机名，只留异常类名
      this.logger.warn(`读取用户通知配置失败，退回默认配置（${error instanceof Error ? error.name : 'UnknownError'}）`)
      return null
    }
  }
}
