/**
 * 就绪检查接口类型
 *
 * **字段名以服务端 VO 为准**（contract-settings 五点五节、contract-runtime-config 4.1）。
 * 抄的是 `GET /system/readiness` 的 `ReadinessVo` / `ReadinessItemVo`，
 * 一个字母都不要自己改——网页这边是手写声明，名字对不上 TypeScript 一句都不会报，
 * 只会在跑起来之后表现成「横幅永远不出现」或者「每一项都显示成没配」。
 *
 * 两条约定：
 * - `detail` 是给人看的失败原因**原文，不做 i18n**，服务端保证里面**不含任何 Key**。
 *   网页照原样显示，不要拿它去拼别的东西，也不要写进 URL 或埋点。
 * - `status` 只有三种，别在网页里再造第四种。「跳过」是网页自己的展示状态，不属于服务端。
 */

/**
 * 检查项的键，逐个对应契约 4.1 的五项。
 * 服务端以后加项时网页不会崩：认不出来的 key 走兜底文案，不要用穷举 switch 处理。
 */
export enum ReadinessItemKey {
  /** 上游 AI（「让 AI 提炼方向」用的就是这条） */
  AgentUpstream = 'agentUpstream',
  /** 对话模型清单与 OpenAI 通道密钥 */
  AiChatModels = 'aiChatModels',
  /** 对象存储 */
  Assets = 'assets',
  /** 物料根目录 */
  ProjectsRoot = 'projectsRoot',
  /** 通知通道，非必需 */
  Notify = 'notify',
}

/** 单项检查结果的状态 */
export enum ReadinessStatus {
  /** 通过 */
  Ok = 'ok',
  /** 没配 */
  Missing = 'missing',
  /** 配了但探测失败 */
  Error = 'error',
}

/** 单项检查结果，对应服务端 `ReadinessItemVo` */
export interface ReadinessItemVo {
  /** 检查项的键，见 `ReadinessItemKey`；服务端以后可能加新值 */
  key: string
  status: ReadinessStatus
  /** false 的项不拦人，只提示 */
  required: boolean
  /** 形如 `agent.baseUrl`，引导页据此定位到对应字段；没有对应字段时是 null */
  configPath: string | null
  /** 失败原因原文，给人看的，不做 i18n；服务端保证不含 Key */
  detail: string | null
}

/** 就绪检查结果，对应服务端 `ReadinessVo` */
export interface ReadinessVo {
  /** 所有 required 项都是 ok */
  ready: boolean
  items: ReadinessItemVo[]
}
