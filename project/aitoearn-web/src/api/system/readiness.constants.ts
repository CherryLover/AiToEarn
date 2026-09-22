/**
 * 就绪检查与运行时覆盖层的常量
 *
 * 错误码抄 `libs/common/src/enums/response-code.enum.ts`（20800-20849 覆盖层、
 * 20850-20899 就绪检查），**不要自己编号**。受保护键抄 contract-runtime-config 3.3。
 */

/**
 * 只能从部署环境（`.env` + 重新部署）改的顶层键，覆盖层会拒。
 * 逐个对应契约 3.3 的受保护名单。
 *
 * 这是**兜底**：服务端 `GET /config` 会回 `protectedPaths`，有就以服务端为准。
 * 本地这份只在服务端还没补上那个字段时用——没有它，引导页会让用户填一个注定保存失败的框。
 */
export const PROTECTED_CONFIG_TOP_LEVEL_KEYS = [
  'port',
  'appDomain',
  'logger',
  'enableConfigLogging',
  'enableBadRequestDetails',
  'auth',
  'mongodb',
  'redis',
  'redlock',
  'assets',
  'serverClient',
  'projects',
] as const

/**
 * 运行时配置覆盖层相关业务错误码，**逐个对应**服务端 `ResponseCode` 的 20800 段。
 *
 * 兜底策略同通知模块：命中下表就用本地文案，没命中就显示服务端返回的 message，
 * 都没有才落到本地的「保存失败」。服务端在这一段里加码，网页不会哑掉。
 */
export const CONFIG_OVERRIDE_ERROR_CODE = {
  /** 20800 这一项只能从部署环境改，不接受运行时覆盖 */
  ProtectedKey: 20800,
  /** 20801 覆盖文件写入失败 */
  WriteFailed: 20801,
  /** 20802 覆盖文件读取失败：不存在不算失败，格式坏了才算 */
  ReadFailed: 20802,
  /** 20803 合并覆盖层之后的配置过不了 schema 校验 */
  Invalid: 20803,
  /** 20804 覆盖文件后缀不是 yaml/yml/json */
  UnsupportedFormat: 20804,
} as const

/**
 * 就绪检查相关业务错误码，**逐个对应**服务端 `ResponseCode` 的 20850 段。
 * 注意：单项探测失败是**回在 `items[].status` 里的**，不走错误码；
 * 下面这两个说的是检查本身出错。
 */
export const SYSTEM_READINESS_ERROR_CODE = {
  /** 20850 探测某一项时自己出错了（不是被探的那方的问题） */
  ProbeFailed: 20850,
  /** 20851 上游连不上或拒绝 */
  UpstreamUnreachable: 20851,
} as const
