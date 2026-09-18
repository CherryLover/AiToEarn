/**
 * 执行工单（ExecutionTask）接口常量
 * 与服务端契约保持一致：默认分页、echo 文本上限、业务错误码。
 */

/** 工单列表默认每页条数 */
export const EXECUTION_TASK_PAGE_SIZE = 20

/** echo 工单文本最长长度，跟服务端 CreateEchoTaskDto 一致 */
export const ECHO_MESSAGE_MAX_LENGTH = 500

/** 默认租约时长（秒），对应服务端配置 executionTask.leaseSeconds */
export const EXECUTION_TASK_LEASE_SECONDS = 300

/**
 * 工单相关业务错误码，对应服务端 ResponseCode 20400 段。
 * 其中带「设备侧」注释的只有浏览器插件会碰到，网页不做单独文案。
 */
export const EXECUTION_TASK_ERROR_CODE = {
  /** 工单不存在或不属于当前用户 */
  NotFound: 20400,
  /** 设备侧：租约 id 对不上 */
  LeaseInvalid: 20401,
  /** 设备侧：租约已过期 */
  LeaseExpired: 20402,
  /** 当前状态不允许这个操作 */
  StatusInvalid: 20403,
  /** 设备侧：暂时没有可领的活 */
  NoneAvailable: 20404,
  /** 设备侧：手动工单不参与领取 */
  ManualNotClaimable: 20405,
  /** 设备侧：设备能力不匹配 */
  CapabilityMismatch: 20406,
  /** 设备侧：工单指定了别的设备 */
  DeviceMismatch: 20407,
  /** 设备侧：工单已被别的设备领走 */
  AlreadyClaimed: 20408,
  /** 设备侧：这单不是该设备租的 */
  NotLeasedByDevice: 20409,
  /** 不支持的工单类型 */
  TypeNotSupported: 20410,
  /** 工单载荷不合规 */
  PayloadInvalid: 20411,
  /** 设备侧：回报的结果不合规 */
  ResultInvalid: 20412,
  /** 工单创建失败 */
  CreateFailed: 20413,
  /** 当前状态不允许取消 */
  CancelNotAllowed: 20414,
  /** 当前状态不允许重试 */
  RetryNotAllowed: 20415,
  /** 重试次数已用尽 */
  MaxAttemptsExceeded: 20416,
  /** 不是手动工单，不能手动登记完成 */
  ManualCompleteNotAllowed: 20417,
  /** 工单不属于这个项目 */
  ProjectMismatch: 20418,
} as const
