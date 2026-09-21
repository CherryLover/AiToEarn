/**
 * 执行工单（ExecutionTask）接口类型
 * 字段严格对应服务端 ExecutionTaskListItemVo / ExecutionTaskDetailVo
 * （core/execution-tasks/execution-tasks.vo.ts），不要在此处自行增删字段或改名。
 * 注意与 AI 服务的 ContentGenerationTask 无关，两者是两套东西。
 */

/**
 * 工单类型。
 */
export enum ExecutionTaskType {
  /** 发布一条内容 */
  Publish = 'publish',
  /** 去平台找回刚发的帖子链接 */
  ClaimLink = 'claim_link',
  /** 采集某条帖子的数据。定义还在，但实测小红书没有可寻址的单帖入口，服务端和插件都没有实现 */
  CollectMetrics = 'collect_metrics',
  /** 把一个创作平台账号的作品列表整张读回来 */
  SyncCreatorNotes = 'sync_creator_notes',
  /** 打通链路用，原样返回 */
  Echo = 'echo',
}

/**
 * 执行方式。
 */
export enum ExecutionTaskMode {
  /** 设备自动执行 */
  Auto = 'auto',
  /** 内容打包给人，人去发完回来登记 */
  Manual = 'manual',
}

/**
 * 工单状态。
 */
export enum ExecutionTaskStatus {
  Pending = 'pending',
  Leased = 'leased',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/**
 * ExecutionTask 列表项数据结构。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
export interface ExecutionTaskListItem {
  id: string
  projectId: string
  /** 属于哪个发布方向，归因用 */
  angleId: string | null
  type: ExecutionTaskType
  mode: ExecutionTaskMode
  status: ExecutionTaskStatus
  /** 指定必须由哪台设备执行；空表示任意合格设备。重排时不会被清掉 */
  targetDeviceId: string | null
  /** 当前（或最近一次）持有这个工单的设备 */
  deviceId: string | null
  /** 干这活需要的能力，如 xhs */
  requiredCapability: string | null
  /** 失败原因，给人看的。设备写在最前面的业务码已经摘掉了，在 errorCode 里 */
  error: string | null
  /** 失败原因对应的业务码（采集失败是 20700 段）；设备没给码时为 null */
  errorCode: number | null
  /** 已尝试次数 */
  attempts: number
  /** 最多尝试几次 */
  maxAttempts: number
  /** 到点才可领取，排期和重试退避都用它 */
  availableAt: string
  /** 租约到期时间 */
  leaseExpiresAt: string | null
  /** 越小越先 */
  priority: number
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * ExecutionTask 详情数据结构，比列表项多出载荷和结果。
 */
export interface ExecutionTaskDetail extends ExecutionTaskListItem {
  /** 按 type 不同，结构见骨架契约第四节 */
  payload: Record<string, unknown>
  /** 执行结果，没执行完时为空 */
  result: Record<string, unknown> | null
}

/**
 * ExecutionTaskListData：服务端分页返回的包装，对应 ExecutionTaskListVo。
 */
export interface ExecutionTaskListData {
  page: number
  pageSize: number
  totalPages: number
  total: number
  list: ExecutionTaskListItem[]
}

/**
 * GetExecutionTaskListParams 请求参数，筛选项全部可选，分页字段跟服务端一致。
 */
export interface GetExecutionTaskListParams {
  projectId?: string
  angleId?: string
  deviceId?: string
  type?: ExecutionTaskType
  mode?: ExecutionTaskMode
  status?: ExecutionTaskStatus
  page?: number
  pageSize?: number
}

/**
 * CreateEchoTaskParams 请求参数，对应服务端 CreateEchoTaskDto，
 * 网页只用到其中几项，其余用服务端默认值。
 */
export interface CreateEchoTaskParams {
  projectId: string
  /** 原样回传的内容 */
  message: string
  /** 指定必须由哪台设备执行；不传表示任意合格设备都能领 */
  targetDeviceId?: string
}
