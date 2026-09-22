/**
 * 分步引导页的步骤定义
 *
 * 一个就绪检查项 = 一步（contract-runtime-config 4.2）。这里只声明**结构性**的事实：
 * 配置落在哪个服务、能不能在网页上就地填、改完要不要重启。
 * 「这是什么、不配会怎样、去哪拿」全部是文案，在 `setup.json` 里，不要往这里塞句子。
 *
 * 加检查项时：服务端 `items` 里多一个 key，这里没有对应 spec 也不会崩——
 * 引导页会用 `configPath` 兜底渲染成一个通用输入框（见 `setup.utils.ts`）。
 */

import { ConfigEditorServiceTarget } from '@/api/config-editor/config-editor.types'
import { ReadinessItemKey } from '@/api/system/readiness.types'

/** 一个可就地填写的字段 */
export interface SetupFieldSpec {
  /** 配置里的键路径，形如 `agent.baseUrl` */
  path: string
  /**
   * 是不是密钥。密钥用 `PasswordInput`，**读回来的值不回填输入框**，
   * 留空提交表示「不改」——跟设置页那条规矩一致，免得把占位符存成真 Key。
   */
  secret?: boolean
  /** 必填。非必填的字段留空就是不动它 */
  required?: boolean
}

/** 一步 */
export interface SetupStepSpec {
  key: string
  /** 这项配置落在哪个服务的配置文件里 */
  target: ConfigEditorServiceTarget
  /**
   * 改完是不是立刻生效。
   * 契约 3.5：**只有 `agent` 一段做热生效**，其余保存完要重启服务才算数。
   * 这个标记决定引导页要不要在保存后露出「重启服务」按钮——
   * 少了它，用户会保存成功、复检还是红的，然后不知道自己该干什么。
   */
  hotReload: boolean
  /** 能在网页上就地填的字段。**空数组 = 只能去部署环境改**（受保护顶层键，契约 3.3） */
  fields: SetupFieldSpec[]
}

/**
 * 步骤顺序 = 契约 4.1 检查项表的顺序：四个必需项在前，非必需的通知在最后。
 * 服务端返回里没有的 key 不显示，返回里多出来的 key 按兜底方式补在后面。
 */
export const SETUP_STEP_SPECS: SetupStepSpec[] = [
  {
    // 「让 AI 提炼方向」报错的就是这一项：上游从来没被部署配置覆盖过，一直用占位值
    key: ReadinessItemKey.AgentUpstream,
    target: ConfigEditorServiceTarget.Ai,
    hotReload: true,
    fields: [
      { path: 'agent.baseUrl', required: true },
      { path: 'agent.apiKey', secret: true, required: true },
      { path: 'agent.defaultModel', required: true },
    ],
  },
  {
    key: ReadinessItemKey.AiChatModels,
    target: ConfigEditorServiceTarget.Ai,
    hotReload: false,
    fields: [
      { path: 'ai.openai.apiKey', secret: true, required: true },
      { path: 'ai.openai.baseUrl' },
    ],
  },
  {
    // `assets` 是受保护顶层键（契约 3.3），覆盖层会拒，只能改 .env 重新部署
    key: ReadinessItemKey.Assets,
    target: ConfigEditorServiceTarget.Server,
    hotReload: false,
    fields: [],
  },
  {
    // `projects` 同上
    key: ReadinessItemKey.ProjectsRoot,
    target: ConfigEditorServiceTarget.Server,
    hotReload: false,
    fields: [],
  },
  {
    key: ReadinessItemKey.Notify,
    target: ConfigEditorServiceTarget.Server,
    hotReload: false,
    fields: [],
  },
]

/**
 * 明知是占位值的密钥。
 * `sk-placeholder` 就是仓库里那个害得「让 AI 提炼方向」一直报错的值（契约 4.1），
 * 它在界面上得显示成「没配」，不是「已设置」——否则用户看着「已设置」却怎么都用不了。
 */
export const PLACEHOLDER_SECRET_VALUES = ['sk-placeholder', 'change-me', 'changeme', 'placeholder']

/** 这些片段出现在键路径末段时按密钥处理：兜底渲染用 */
export const SECRET_PATH_HINTS = ['apikey', 'secret', 'token', 'password']
