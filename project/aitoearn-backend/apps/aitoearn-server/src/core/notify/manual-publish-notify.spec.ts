/**
 * 第二个推送点：建 manual 发布工单时推一条「有一条等你去发」。
 *
 * 钩子接在 `ExecutionTasksService.create()` 上——所有工单都从这一个口子出来，
 * 接这里就不用去碰 publishing 模块（那是另一个 Agent 的地盘）。
 */
import { Logger } from '@nestjs/common'
import { ExecutionTaskMode, ExecutionTaskStatus, ExecutionTaskType } from '@yikart/mongodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionTasksService } from '../execution-tasks/execution-tasks.service'

vi.mock('../../config', () => ({
  config: {
    device: { heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 },
    executionTask: { leaseSeconds: 300, maxAttempts: 3 },
  },
}))

// 照 execution-tasks.integration.spec.ts 的写法：测试环境下 @Prop 拿不到类型元数据，桩掉即可
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

const PUBLISH_PAYLOAD = {
  platform: 'xhs',
  accountId: 'acc-1',
  draftPath: 'drafts/2026-09-18-xhs-pain-point',
  snapshot: { title: '导出藏得太深，四步变一步', body: '正文', topics: [], mediaUrls: [] },
}

describe('建 manual 工单时推一条提醒', () => {
  let created: Record<string, unknown>[]
  let notifyManualPublishPending: ReturnType<typeof vi.fn>
  let service: ExecutionTasksService

  function createService(notify?: unknown) {
    const repository = {
      create: vi.fn(async (data: Record<string, unknown>) => {
        const doc = { id: `task-${created.length + 1}`, ...data }
        created.push(doc)
        return doc
      }),
    }
    const gateway = { notifyTaskAvailable: vi.fn() }

    return new ExecutionTasksService(repository as never, gateway as never, notify as never)
  }

  beforeEach(() => {
    created = []
    notifyManualPublishPending = vi.fn().mockResolvedValue(true)
    service = createService({ enabled: true, notifyManualPublishPending })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('manual 的发布工单：带上平台和快照标题推一条', async () => {
    await service.create('user-1', {
      projectId: 'proj-1',
      type: ExecutionTaskType.PUBLISH,
      mode: ExecutionTaskMode.MANUAL,
      payload: PUBLISH_PAYLOAD,
    })

    expect(notifyManualPublishPending).toHaveBeenCalledWith({
      platform: 'xhs',
      title: '导出藏得太深，四步变一步',
    })
  })

  it('auto 的工单不推：那是设备自己去领的，不用喊人', async () => {
    await service.create('user-1', {
      projectId: 'proj-1',
      type: ExecutionTaskType.PUBLISH,
      mode: ExecutionTaskMode.AUTO,
      payload: PUBLISH_PAYLOAD,
    })

    expect(notifyManualPublishPending).not.toHaveBeenCalled()
  })

  it('打通链路用的 echo 工单不推，哪怕是 manual', async () => {
    await service.create('user-1', {
      projectId: 'proj-1',
      type: ExecutionTaskType.ECHO,
      mode: ExecutionTaskMode.MANUAL,
      payload: { message: 'ping' },
    })

    expect(notifyManualPublishPending).not.toHaveBeenCalled()
  })

  it('推送整个炸了也不影响建单', async () => {
    const exploding = createService({
      enabled: true,
      notifyManualPublishPending: () => {
        throw new Error('推送服务挂了')
      },
    })

    const task = await exploding.create('user-1', {
      projectId: 'proj-1',
      type: ExecutionTaskType.PUBLISH,
      mode: ExecutionTaskMode.MANUAL,
      payload: PUBLISH_PAYLOAD,
    })

    expect(task.status).toBe(ExecutionTaskStatus.PENDING)
  })

  it('推送是异步失败的也不影响建单，而且不会漏成未处理的 Promise 拒绝', async () => {
    // 未处理的拒绝在 Node 默认配置下会让进程直接退出，光靠外层 try/catch 接不住
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const rejecting = createService({
      enabled: true,
      notifyManualPublishPending: vi.fn().mockRejectedValue(new Error('Bark 超时')),
    })

    const task = await rejecting.create('user-1', {
      projectId: 'proj-1',
      type: ExecutionTaskType.PUBLISH,
      mode: ExecutionTaskMode.MANUAL,
      payload: PUBLISH_PAYLOAD,
    })

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(task.status).toBe(ExecutionTaskStatus.PENDING)
    expect(warn).toHaveBeenCalledWith(expect.any(Error), '待人工发布推送失败')
  })

  it('没接推送服务（没配、没注册）照样建单', async () => {
    const withoutNotify = createService(undefined)

    const task = await withoutNotify.create('user-1', {
      projectId: 'proj-1',
      type: ExecutionTaskType.PUBLISH,
      mode: ExecutionTaskMode.MANUAL,
      payload: PUBLISH_PAYLOAD,
    })

    expect(task.mode).toBe(ExecutionTaskMode.MANUAL)
  })
})
