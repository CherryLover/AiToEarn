/**
 * 服务端自证：插件还没有，所以这里用假的 Mongo 模型把真实的仓储、服务、控制器、
 * 守卫全串起来，直接以「设备」的身份走完整条链路。
 *
 * 假模型的 findOneAndUpdate 会先 await 一次再同步地「匹配 + 更新」——
 * 这正是 MongoDB 的单文档原子性：调用之间有真正的交错点，但一次匹配加更新不可被打断。
 * 如果领取写成了「先查后改」，下面的并发用例一定会挂。
 */
import { ResponseCode } from '@yikart/common'
import {
  DeviceRepository,
  ExecutionTaskMode,
  ExecutionTaskRepository,
  ExecutionTaskStatus,
  ExecutionTaskType,
} from '@yikart/mongodb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceApiController } from '../devices/device-api.controller'
import { DeviceAuthGuard } from '../devices/device-auth.guard'
import { DevicesService } from '../devices/devices.service'
import { DeviceTasksController } from './device-tasks.controller'
import { ExecutionTaskReaper } from './execution-task.reaper'
import { ExecutionTasksController } from './execution-tasks.controller'
import { computeBackoffSeconds, ExecutionTasksService } from './execution-tasks.service'

vi.mock('../../config', () => ({
  config: {
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

/**
 * @yikart/mongodb 的桶文件在 vitest 里加载不了：vite 的转译器拿不到跨模块的类型信息，
 * 别的表上那些「枚举类型的 @Prop」反射出来是 Object，@nestjs/mongoose 当场报错。
 * 把 @Prop 换成空装饰器就绕过去了——这里要的是真的仓储实现，
 * 至于 mongoose 的 schema 长什么样，本文件一个都用不到。
 */
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

// ============ 假的 Mongo 模型 ============

type Doc = Record<string, any>

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function isDateLike(value: unknown): value is Date | number {
  return value instanceof Date || typeof value === 'number'
}

function toComparable(value: unknown): number | null {
  if (value instanceof Date)
    return value.getTime()
  if (typeof value === 'number')
    return value
  return null
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime()
  return a === b
}

/** Mongo 的类型分桶：null / 缺失跟日期做大小比较永远不成立 */
function compareOp(value: unknown, operand: unknown, op: '$lt' | '$lte' | '$gt' | '$gte'): boolean {
  if (!isDateLike(value) || !isDateLike(operand))
    return false

  const left = toComparable(value)!
  const right = toComparable(operand)!
  switch (op) {
    case '$lt': return left < right
    case '$lte': return left <= right
    case '$gt': return left > right
    case '$gte': return left >= right
  }
}

function matchCondition(value: unknown, condition: unknown): boolean {
  const isOperatorObject = condition !== null
    && typeof condition === 'object'
    && !(condition instanceof Date)
    && !Array.isArray(condition)
    && Object.keys(condition as object).every(key => key.startsWith('$'))

  if (!isOperatorObject)
    return looseEqual(value, condition)

  for (const [op, operand] of Object.entries(condition as Record<string, unknown>)) {
    switch (op) {
      case '$in': {
        const candidates = operand as unknown[]
        // $in 里的 null 同时匹配「字段是 null」和「字段不存在」
        const hit = candidates.some(candidate =>
          candidate === null
            ? value === null || value === undefined
            : looseEqual(value, candidate),
        )
        if (!hit)
          return false
        break
      }
      case '$ne':
        if (looseEqual(value, operand))
          return false
        break
      case '$exists': {
        const exists = value !== undefined && value !== null
        if (exists !== operand)
          return false
        break
      }
      case '$lt': case '$lte': case '$gt': case '$gte':
        if (!compareOp(value, operand, op))
          return false
        break
      default:
        throw new Error(`假模型不认识的查询操作符: ${op}`)
    }
  }

  return true
}

function matches(doc: Doc, filter: Doc): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const field = key === '_id' ? 'id' : key
    if (!matchCondition(doc[field], condition))
      return false
  }
  return true
}

function sortDocs(docs: Doc[], sort?: Record<string, 1 | -1>): Doc[] {
  if (!sort)
    return docs

  const entries = Object.entries(sort)
  return [...docs].sort((a, b) => {
    for (const [field, direction] of entries) {
      const left = toComparable(a[field]) ?? a[field]
      const right = toComparable(b[field]) ?? b[field]
      if (left === right)
        continue
      if (left === undefined || left === null)
        return 1
      if (right === undefined || right === null)
        return -1
      return left < right ? -direction : direction
    }
    return 0
  })
}

function applyUpdate(doc: Doc, update: Doc) {
  const set = update.$set ?? (Object.keys(update).some(key => key.startsWith('$')) ? undefined : update)
  if (set) {
    for (const [field, value] of Object.entries(set))
      doc[field] = value
  }
  if (update.$inc) {
    for (const [field, value] of Object.entries(update.$inc as Record<string, number>))
      doc[field] = (doc[field] ?? 0) + value
  }
  if (update.$unset) {
    for (const field of Object.keys(update.$unset as object))
      delete doc[field]
  }
  doc.updatedAt = new Date()
}

function createFakeModel(prefix: string) {
  const docs: Doc[] = []
  let seq = 0

  const chain = (run: () => Promise<unknown> | unknown) => ({
    lean: () => ({ exec: async () => await run() }),
    exec: async () => await run(),
  })

  const snapshot = (doc: Doc | undefined | null) => (doc ? { ...doc } : null)

  interface FakeDocument {
    data: Doc
    save: () => Promise<{ toObject: () => Doc }>
  }

  function FakeModel(this: FakeDocument, data: Doc) {
    this.data = data
    this.save = async () => {
      const now = new Date()
      // 对应 schema 里的 timestamps: true
      const doc: Doc = { id: `${prefix}-${++seq}`, ...data, createdAt: now, updatedAt: now }
      docs.push(doc)
      return { toObject: () => ({ ...doc }) }
    }
  }

  return Object.assign(FakeModel as unknown as Doc, {
    __docs: docs,
    findById: (id: string) => chain(() => snapshot(docs.find(doc => doc.id === id))),
    findByIdAndUpdate: (id: string, update: Doc) => chain(async () => {
      await tick()
      const doc = docs.find(item => item.id === id)
      if (!doc)
        return null
      applyUpdate(doc, update)
      return snapshot(doc)
    }),
    findOne: (filter: Doc) => chain(async () => {
      await tick()
      return snapshot(docs.find(doc => matches(doc, filter)))
    }),
    /** 先 await 制造交错点，再同步地匹配 + 更新——这一段就是 Mongo 的单文档原子性 */
    findOneAndUpdate: (filter: Doc, update: Doc, options: Doc = {}) => chain(async () => {
      await tick()
      const candidates = sortDocs(docs.filter(doc => matches(doc, filter)), options.sort)
      const doc = candidates[0]
      if (!doc)
        return null
      applyUpdate(doc, update)
      return snapshot(doc)
    }),
    find: (filter: Doc = {}, _projection?: unknown, options: Doc = {}) => chain(async () => {
      await tick()
      const found = sortDocs(docs.filter(doc => matches(doc, filter)), options.sort)
      const skipped = options.skip ? found.slice(options.skip) : found
      return (options.limit ? skipped.slice(0, options.limit) : skipped).map(doc => ({ ...doc }))
    }),
    countDocuments: (filter: Doc = {}) => chain(async () => docs.filter(doc => matches(doc, filter)).length),
  })
}

// ============ 测试装置 ============

const USER_ID = 'user-1'
const PROJECT_ID = 'project-1'

function createFakeRedis() {
  const store = new Map<string, string>()
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setNx: vi.fn(async (key: string, value: string) => {
      if (store.has(key))
        return false
      store.set(key, value)
      return true
    }),
    del: vi.fn(async (key: string) => store.delete(key)),
  }
}

function createHarness() {
  const deviceModel = createFakeModel('device')
  const taskModel = createFakeModel('task')

  const deviceRepository = new DeviceRepository(deviceModel)
  const executionTaskRepository = new ExecutionTaskRepository(taskModel)
  const redis = createFakeRedis()

  const devicesService = new DevicesService(deviceRepository, redis as never)
  const gateway = { notifyTaskAvailable: vi.fn(() => 0) }
  const executionTasksService = new ExecutionTasksService(executionTaskRepository, gateway as never)

  return {
    deviceModel,
    taskModel,
    redis,
    devicesService,
    executionTasksService,
    gateway,
    deviceRepository,
    executionTaskRepository,
    deviceApiController: new DeviceApiController(devicesService),
    deviceTasksController: new DeviceTasksController(executionTasksService),
    adminController: new ExecutionTasksController(executionTasksService),
    reaper: new ExecutionTaskReaper(executionTaskRepository, executionTasksService),
    guard: new DeviceAuthGuard(devicesService),
  }
}

type Harness = ReturnType<typeof createHarness>

/** 走真接口配一台设备出来：生成配对码 → 插件拿码换令牌 */
async function pairDevice(harness: Harness, name: string, capabilities: string[] = []) {
  const { code } = await harness.devicesService.createPairingCode(USER_ID)
  const paired = await harness.deviceApiController.pair({
    code,
    name,
    capabilities,
    accounts: [],
  } as never)

  const device = await harness.devicesService.authenticateToken(paired.token)
  return { device, token: paired.token, vo: paired.device }
}

async function createEchoTask(harness: Harness, overrides: Record<string, unknown> = {}) {
  return await harness.adminController.createEcho(
    { id: USER_ID } as never,
    {
      projectId: PROJECT_ID,
      message: 'ping',
      mode: ExecutionTaskMode.AUTO,
      priority: 100,
      ...overrides,
    } as never,
  )
}

/** 把某条工单的租约时间往前挪，模拟「租约已经过期但回收还没跑」 */
function expireLease(harness: Harness, taskId: string, secondsAgo = 1) {
  const doc = harness.taskModel.__docs.find((item: Doc) => item.id === taskId)
  doc.leaseExpiresAt = new Date(Date.now() - secondsAgo * 1000)
}

let harness: Harness

beforeEach(() => {
  harness = createHarness()
})

// ============ 用例 ============

describe('执行端链路 · 配对到回报', () => {
  it('配对 → 领取 → 续租 → 上报开始 → 回报成功，整条走通', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac', ['xhs'])
    const created = await createEchoTask(harness)

    const claimed = await harness.deviceTasksController.claim(device)
    expect(claimed.task).not.toBeNull()
    expect(claimed.task!.id).toBe(created.id)
    expect(claimed.task!.payload).toEqual({ message: 'ping' })
    expect(claimed.task!.leaseId).toMatch(/^[0-9a-z]{24}$/)

    const leaseId = claimed.task!.leaseId
    const firstExpiry = claimed.task!.leaseExpiresAt

    const renewed = await harness.deviceTasksController.renew(device, created.id, { leaseId } as never)
    expect(renewed.status).toBe(ExecutionTaskStatus.LEASED)
    expect(renewed.leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(firstExpiry.getTime())

    const started = await harness.deviceTasksController.start(device, created.id, { leaseId } as never)
    expect(started.status).toBe(ExecutionTaskStatus.RUNNING)

    const reported = await harness.deviceTasksController.report(device, created.id, {
      leaseId,
      success: true,
      result: { message: 'ping', deviceTime: new Date() },
    } as never)
    expect(reported.status).toBe(ExecutionTaskStatus.SUCCEEDED)

    const detail = await harness.adminController.getDetail({ id: USER_ID } as never, created.id)
    expect(detail.status).toBe(ExecutionTaskStatus.SUCCEEDED)
    expect(detail.result).toMatchObject({ message: 'ping' })
    expect(detail.finishedAt).toBeInstanceOf(Date)
  })

  it('配对返回的明文令牌只给这一次，库里存的是哈希', async () => {
    const { token } = await pairDevice(harness, '家里的 Mac')
    const stored = harness.deviceModel.__docs[0]

    expect(token).toMatch(/^dev_[0-9A-Za-z]{48}$/)
    expect(stored.tokenHash).not.toBe(token)
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  it('配对码用过一次就作废', async () => {
    const { code } = await harness.devicesService.createPairingCode(USER_ID)
    await harness.deviceApiController.pair({ code, name: '第一台', capabilities: [], accounts: [] } as never)

    await expect(
      harness.deviceApiController.pair({ code, name: '第二台', capabilities: [], accounts: [] } as never),
    ).rejects.toMatchObject({ code: ResponseCode.DevicePairingCodeInvalid })
  })

  it('没带令牌、令牌不对、设备被吊销，守卫都拦下来', async () => {
    const { token, device } = await pairDevice(harness, '家里的 Mac')
    const ctx = (headers: Record<string, string>) => ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as never

    await expect(harness.guard.canActivate(ctx({})))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceTokenMissing })
    await expect(harness.guard.canActivate(ctx({ authorization: 'Bearer dev_nope' })))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceTokenInvalid })

    await expect(harness.guard.canActivate(ctx({ authorization: `Bearer ${token}` }))).resolves.toBe(true)

    await harness.devicesService.revoke(device.id, USER_ID)
    await expect(harness.guard.canActivate(ctx({ authorization: `Bearer ${token}` })))
      .rejects
      .toMatchObject({ code: ResponseCode.DeviceTokenInvalid })
  })
})

describe('执行端链路 · 并发领取', () => {
  it('10 台设备同时抢同一个工单，只有一台拿到', async () => {
    const devices = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pairDevice(harness, `设备 ${i}`)),
    )
    const created = await createEchoTask(harness)

    const results = await Promise.all(
      devices.map(({ device }) => harness.deviceTasksController.claim(device)),
    )

    const winners = results.filter(result => result.task !== null)
    expect(winners).toHaveLength(1)
    expect(winners[0]!.task!.id).toBe(created.id)

    const stored = harness.taskModel.__docs[0]
    expect(stored.status).toBe(ExecutionTaskStatus.LEASED)
    expect(stored.attempts).toBe(0)
  })

  it('3 个工单 12 台设备同时抢，每个工单恰好被领走一次', async () => {
    const devices = await Promise.all(
      Array.from({ length: 12 }, (_, i) => pairDevice(harness, `设备 ${i}`)),
    )
    await Promise.all([createEchoTask(harness), createEchoTask(harness), createEchoTask(harness)])

    const results = await Promise.all(
      devices.map(({ device }) => harness.deviceTasksController.claim(device)),
    )

    const claimedIds = results.filter(r => r.task).map(r => r.task!.id)
    expect(claimedIds).toHaveLength(3)
    expect(new Set(claimedIds).size).toBe(3)
  })

  it('优先级小的先被领走', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    await createEchoTask(harness, { priority: 500, message: '慢的' })
    const urgent = await createEchoTask(harness, { priority: 1, message: '急的' })

    const claimed = await harness.deviceTasksController.claim(device)
    expect(claimed.task!.id).toBe(urgent.id)
  })
})

describe('执行端链路 · 租约是不重复执行的根本保证', () => {
  it('leaseId 对不上的回报一律拒绝', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    await harness.deviceTasksController.claim(device)

    await expect(harness.deviceTasksController.report(device, created.id, {
      leaseId: 'someone-elses-lease',
      success: true,
      result: { message: 'ping', deviceTime: new Date() },
    } as never)).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskLeaseInvalid })

    expect(harness.taskModel.__docs[0].status).toBe(ExecutionTaskStatus.LEASED)
  })

  it('租约过期后的迟到回报被拒，覆盖不了后来者的成果', async () => {
    const slow = await pairDevice(harness, '慢的那台')
    const fast = await pairDevice(harness, '快的那台')
    const created = await createEchoTask(harness)

    const slowClaim = await harness.deviceTasksController.claim(slow.device)
    const slowLeaseId = slowClaim.task!.leaseId

    // 慢设备拿着活不动，租约到期被回收，重新排队
    expireLease(harness, created.id)
    await harness.reaper.reclaimExpiredLeases()
    harness.taskModel.__docs[0].availableAt = new Date(Date.now() - 1000)

    // 快设备接手并干成
    const fastClaim = await harness.deviceTasksController.claim(fast.device)
    expect(fastClaim.task).not.toBeNull()
    await harness.deviceTasksController.report(fast.device, created.id, {
      leaseId: fastClaim.task!.leaseId,
      success: true,
      result: { message: '快的干完了', deviceTime: new Date() },
    } as never)

    // 慢设备这时才醒过来回报，必须被拒
    await expect(harness.deviceTasksController.report(slow.device, created.id, {
      leaseId: slowLeaseId,
      success: true,
      result: { message: '慢的迟到了', deviceTime: new Date() },
    } as never)).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskNotLeasedByDevice })

    const detail = await harness.adminController.getDetail({ id: USER_ID } as never, created.id)
    expect(detail.status).toBe(ExecutionTaskStatus.SUCCEEDED)
    expect(detail.result).toMatchObject({ message: '快的干完了' })
    expect(detail.deviceId).toBe(fast.device.id)
  })

  it('租约刚过期、回收还没跑时回报，同样被拒', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    const claimed = await harness.deviceTasksController.claim(device)

    expireLease(harness, created.id)

    await expect(harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: true,
      result: { message: 'ping', deviceTime: new Date() },
    } as never)).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskLeaseExpired })

    await expect(harness.deviceTasksController.renew(device, created.id, {
      leaseId: claimed.task!.leaseId,
    } as never)).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskLeaseExpired })
  })
})

describe('执行端链路 · 超时回收与退避重试', () => {
  it('租约超时：attempts + 1，退回待领取，按退避推迟可领时间', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    await harness.deviceTasksController.claim(device)

    expireLease(harness, created.id)
    const before = Date.now()
    await harness.reaper.reclaimExpiredLeases()

    const stored = harness.taskModel.__docs[0]
    expect(stored.status).toBe(ExecutionTaskStatus.PENDING)
    expect(stored.attempts).toBe(1)
    expect(stored.leaseId).toBeNull()
    expect(stored.deviceId).toBeNull()
    expect(stored.error).toContain('租约超时')

    const waitedSeconds = (stored.availableAt.getTime() - before) / 1000
    expect(waitedSeconds).toBeGreaterThan(computeBackoffSeconds(1) - 5)
    expect(waitedSeconds).toBeLessThanOrEqual(computeBackoffSeconds(1))
  })

  it('退避时间内领不到，到点之后能领到', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    await harness.deviceTasksController.claim(device)

    expireLease(harness, created.id)
    await harness.reaper.reclaimExpiredLeases()

    expect((await harness.deviceTasksController.claim(device)).task).toBeNull()

    harness.taskModel.__docs[0].availableAt = new Date(Date.now() - 1000)
    expect((await harness.deviceTasksController.claim(device)).task!.id).toBe(created.id)
  })

  it('重试用尽转失败，失败后不再被领走', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness, { maxAttempts: 2 })

    for (let round = 1; round <= 2; round++) {
      harness.taskModel.__docs[0].availableAt = new Date(Date.now() - 1000)
      const claimed = await harness.deviceTasksController.claim(device)
      expect(claimed.task, `第 ${round} 次应该能领到`).not.toBeNull()
      expireLease(harness, created.id)
      await harness.reaper.reclaimExpiredLeases()
    }

    const stored = harness.taskModel.__docs[0]
    expect(stored.status).toBe(ExecutionTaskStatus.FAILED)
    expect(stored.attempts).toBe(2)
    expect(stored.finishedAt).toBeInstanceOf(Date)

    harness.taskModel.__docs[0].availableAt = new Date(Date.now() - 1000)
    expect((await harness.deviceTasksController.claim(device)).task).toBeNull()
  })

  it('设备主动回报失败：还有次数就退避重排，用尽就转失败', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness, { maxAttempts: 2 })

    const first = await harness.deviceTasksController.claim(device)
    const afterFirst = await harness.deviceTasksController.report(device, created.id, {
      leaseId: first.task!.leaseId,
      success: false,
      error: '小红书没登录',
    } as never)
    expect(afterFirst.status).toBe(ExecutionTaskStatus.PENDING)
    expect(afterFirst.attempts).toBe(1)
    expect(harness.taskModel.__docs[0].error).toBe('小红书没登录')

    harness.taskModel.__docs[0].availableAt = new Date(Date.now() - 1000)
    const second = await harness.deviceTasksController.claim(device)
    const afterSecond = await harness.deviceTasksController.report(device, created.id, {
      leaseId: second.task!.leaseId,
      success: false,
      error: '还是不行',
    } as never)
    expect(afterSecond.status).toBe(ExecutionTaskStatus.FAILED)
    expect(afterSecond.attempts).toBe(2)
  })

  it('同一条过期租约被两个实例同时扫到，只处理一次', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    await harness.deviceTasksController.claim(device)
    expireLease(harness, created.id)

    await Promise.all([
      harness.reaper.reclaimExpiredLeases(),
      harness.reaper.reclaimExpiredLeases(),
      harness.reaper.reclaimExpiredLeases(),
    ])

    expect(harness.taskModel.__docs[0].attempts).toBe(1)
  })

  it('退避按 min(60 * 2^attempts, 1800) 算，封顶半小时', () => {
    expect(computeBackoffSeconds(1)).toBe(120)
    expect(computeBackoffSeconds(2)).toBe(240)
    expect(computeBackoffSeconds(4)).toBe(960)
    expect(computeBackoffSeconds(5)).toBe(1800)
    expect(computeBackoffSeconds(20)).toBe(1800)
  })
})

describe('执行端链路 · 取消不能被失败结算抹掉', () => {
  /**
   * 失败结算是两步：先原子地吃掉租约（attempts + 1，状态还停在 leased / running），
   * 再把它退避重排或者转失败。两步之间隔着一次数据库往返，人工取消正好能插进这个窗口——
   * 真实竞态下几百轮能撞上一两次，这里把窗口撑开，确定性地复现。
   * 第二步必须认状态，按 _id 裸写就会把「已取消」抹回 pending，被取消的活重新排队再发一遍。
   */
  function cancelInsideReportWindow(taskId: string) {
    const repository = harness.executionTaskRepository
    const original = repository.updateAsFailedAttemptByLease.bind(repository)
    vi.spyOn(repository, 'updateAsFailedAttemptByLease').mockImplementation(async (params) => {
      const consumed = await original(params)
      await harness.executionTasksService.cancel(taskId, USER_ID)
      return consumed
    })
  }

  function cancelInsideReclaimWindow(taskId: string) {
    const repository = harness.executionTaskRepository
    const original = repository.updateAsFailedAttemptByExpiredLease.bind(repository)
    vi.spyOn(repository, 'updateAsFailedAttemptByExpiredLease').mockImplementation(async (id, now, error) => {
      const consumed = await original(id, now, error)
      await harness.executionTasksService.cancel(taskId, USER_ID)
      return consumed
    })
  }

  it('设备回报失败的途中被取消：不会被抹回 pending 再被领走', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    const claimed = await harness.deviceTasksController.claim(device)

    cancelInsideReportWindow(created.id)

    const reported = await harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: false,
      error: '小红书没登录',
    } as never)

    expect(reported.status).toBe(ExecutionTaskStatus.CANCELLED)
    expect(harness.taskModel.__docs[0].status).toBe(ExecutionTaskStatus.CANCELLED)
    expect((await harness.deviceTasksController.claim(device)).task).toBeNull()
  })

  it('重试用尽那一次被取消：不会被改成 failed', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness, { maxAttempts: 1 })
    const claimed = await harness.deviceTasksController.claim(device)

    cancelInsideReportWindow(created.id)

    const reported = await harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: false,
      error: '还是不行',
    } as never)

    expect(reported.status).toBe(ExecutionTaskStatus.CANCELLED)
    expect(harness.taskModel.__docs[0].status).toBe(ExecutionTaskStatus.CANCELLED)
  })

  it('回收器处理过期租约的途中被取消：同样不会被抹回 pending', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    await harness.deviceTasksController.claim(device)
    expireLease(harness, created.id)

    cancelInsideReclaimWindow(created.id)

    await harness.reaper.reclaimExpiredLeases()

    expect(harness.taskModel.__docs[0].status).toBe(ExecutionTaskStatus.CANCELLED)
    harness.taskModel.__docs[0].availableAt = new Date(Date.now() - 1000)
    expect((await harness.deviceTasksController.claim(device)).task).toBeNull()
  })
})

describe('执行端链路 · 谁能领到什么', () => {
  it('manual 的工单设备看不见', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    await createEchoTask(harness, { mode: ExecutionTaskMode.MANUAL })

    expect((await harness.deviceTasksController.claim(device)).task).toBeNull()
    expect(harness.taskModel.__docs[0].status).toBe(ExecutionTaskStatus.PENDING)
  })

  it('manual 的工单靠人工回填完成', async () => {
    const created = await createEchoTask(harness, { mode: ExecutionTaskMode.MANUAL })

    const completed = await harness.adminController.completeManual(
      { id: USER_ID } as never,
      created.id,
      { result: { message: '我自己发完了', deviceTime: new Date() } } as never,
    )

    expect(completed.status).toBe(ExecutionTaskStatus.SUCCEEDED)
  })

  it('取消过的 manual 工单还能回填成功：先标发失败、后来又真发出去了', async () => {
    const created = await createEchoTask(harness, { mode: ExecutionTaskMode.MANUAL })
    await harness.adminController.cancel({ id: USER_ID } as never, created.id)

    const completed = await harness.adminController.completeManual(
      { id: USER_ID } as never,
      created.id,
      { result: { message: '其实发出去了', deviceTime: new Date() } } as never,
    )

    // 卡在 cancelled 的话，这条帖子在阶段 5 的统计里就没有工单了（骨架第六节）
    expect(completed.status).toBe(ExecutionTaskStatus.SUCCEEDED)
  })

  it('已经回填成功的 manual 工单不能再回填一次', async () => {
    const created = await createEchoTask(harness, { mode: ExecutionTaskMode.MANUAL })
    const result = { result: { message: '发完了', deviceTime: new Date() } } as never
    await harness.adminController.completeManual({ id: USER_ID } as never, created.id, result)

    await expect(harness.adminController.completeManual({ id: USER_ID } as never, created.id, result))
      .rejects
      .toMatchObject({ code: ResponseCode.ExecutionTaskStatusInvalid })
  })

  it('auto 的工单不能走人工回填', async () => {
    const created = await createEchoTask(harness)

    await expect(harness.adminController.completeManual(
      { id: USER_ID } as never,
      created.id,
      { result: { message: 'x', deviceTime: new Date() } } as never,
    )).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskManualCompleteNotAllowed })
  })

  it('能力不匹配的设备领不到需要该能力的活', async () => {
    const douyinOnly = await pairDevice(harness, '只会抖音', ['douyin'])
    const xhsDevice = await pairDevice(harness, '会小红书', ['xhs'])
    const created = await createEchoTask(harness, { requiredCapability: 'xhs' })

    expect((await harness.deviceTasksController.claim(douyinOnly.device)).task).toBeNull()
    expect((await harness.deviceTasksController.claim(xhsDevice.device)).task!.id).toBe(created.id)
  })

  it('没写能力要求的活，谁都能领', async () => {
    const { device } = await pairDevice(harness, '什么都不会')
    const created = await createEchoTask(harness)

    expect((await harness.deviceTasksController.claim(device)).task!.id).toBe(created.id)
  })

  it('指定了设备的活，别的设备领不到', async () => {
    const mine = await pairDevice(harness, '指定的那台')
    const other = await pairDevice(harness, '别的那台')
    const created = await createEchoTask(harness, { targetDeviceId: mine.device.id })

    expect((await harness.deviceTasksController.claim(other.device)).task).toBeNull()
    expect((await harness.deviceTasksController.claim(mine.device)).task!.id).toBe(created.id)
  })

  it('排期没到的活领不到', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    await createEchoTask(harness, { availableAt: new Date(Date.now() + 60_000) })

    expect((await harness.deviceTasksController.claim(device)).task).toBeNull()
  })

  it('没活可领时返回 null，不报错', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    await expect(harness.deviceTasksController.claim(device)).resolves.toEqual({ task: null })
  })

  it('别人家的设备领不到我的活', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    await createEchoTask(harness)

    const foreign = { ...device, userId: 'user-2' }
    expect((await harness.deviceTasksController.claim(foreign)).task).toBeNull()
  })
})

describe('执行端链路 · 管理侧', () => {
  it('建 echo 工单时给在线设备推催办，只带类型不带内容', async () => {
    await createEchoTask(harness, { requiredCapability: 'xhs' })

    expect(harness.gateway.notifyTaskAvailable).toHaveBeenCalledWith({
      userId: USER_ID,
      taskType: ExecutionTaskType.ECHO,
      requiredCapability: 'xhs',
      targetDeviceId: null,
    })
  })

  it('网关抛异常不影响建单', async () => {
    harness.gateway.notifyTaskAvailable.mockImplementation(() => {
      throw new Error('网关挂了')
    })

    const created = await createEchoTask(harness)
    expect(created.status).toBe(ExecutionTaskStatus.PENDING)
  })

  it('排期在未来的工单不推催办', async () => {
    await createEchoTask(harness, { availableAt: new Date(Date.now() + 60_000) })
    expect(harness.gateway.notifyTaskAvailable).not.toHaveBeenCalled()
  })

  it('取消正在跑的工单，设备回报会被拒', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    const claimed = await harness.deviceTasksController.claim(device)

    const cancelled = await harness.adminController.cancel({ id: USER_ID } as never, created.id)
    expect(cancelled.status).toBe(ExecutionTaskStatus.CANCELLED)

    await expect(harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: true,
      result: { message: 'ping', deviceTime: new Date() },
    } as never)).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskLeaseInvalid })
  })

  it('已完成的工单取消不了', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    const claimed = await harness.deviceTasksController.claim(device)
    await harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: true,
      result: { message: 'ping', deviceTime: new Date() },
    } as never)

    await expect(harness.adminController.cancel({ id: USER_ID } as never, created.id))
      .rejects
      .toMatchObject({ code: ResponseCode.ExecutionTaskCancelNotAllowed })
  })

  it('只有失败的工单能重试，重试后尝试次数归零', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness, { maxAttempts: 1 })

    const claimed = await harness.deviceTasksController.claim(device)
    await harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: false,
      error: '挂了',
    } as never)
    expect(harness.taskModel.__docs[0].status).toBe(ExecutionTaskStatus.FAILED)

    const retried = await harness.adminController.retry({ id: USER_ID } as never, created.id)
    expect(retried.status).toBe(ExecutionTaskStatus.PENDING)
    expect(retried.attempts).toBe(0)
    expect(retried.error).toBeNull()

    await expect(harness.adminController.retry({ id: USER_ID } as never, created.id))
      .rejects
      .toMatchObject({ code: ResponseCode.ExecutionTaskRetryNotAllowed })
  })

  it('列表能按状态和设备筛，别人的工单看不到', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    await createEchoTask(harness)
    await createEchoTask(harness)
    await harness.deviceTasksController.claim(device)

    const token = { id: USER_ID } as never
    const all = await harness.adminController.listWithPagination(token, { page: 1, pageSize: 10 } as never)
    expect(all.total).toBe(2)

    const leased = await harness.adminController.listWithPagination(token, {
      page: 1,
      pageSize: 10,
      status: ExecutionTaskStatus.LEASED,
    } as never)
    expect(leased.total).toBe(1)
    expect(leased.list[0]!.deviceId).toBe(device.id)

    const foreign = await harness.adminController.listWithPagination({ id: 'user-2' } as never, {
      page: 1,
      pageSize: 10,
    } as never)
    expect(foreign.total).toBe(0)
  })

  it('载荷跟类型对不上直接拒绝建单', async () => {
    await expect(harness.executionTasksService.create(USER_ID, {
      projectId: PROJECT_ID,
      type: ExecutionTaskType.PUBLISH,
      payload: { platform: 'xhs' },
    })).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskPayloadInvalid })
  })

  it('回报的结果格式不对直接拒绝', async () => {
    const { device } = await pairDevice(harness, '家里的 Mac')
    const created = await createEchoTask(harness)
    const claimed = await harness.deviceTasksController.claim(device)

    await expect(harness.deviceTasksController.report(device, created.id, {
      leaseId: claimed.task!.leaseId,
      success: true,
      result: { message: 42 },
    } as never)).rejects.toMatchObject({ code: ResponseCode.ExecutionTaskResultInvalid })
  })
})
