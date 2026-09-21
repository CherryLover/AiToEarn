import type { ExecutionTaskListData } from '@/api/devices/execution-task.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_ERROR_CODE } from '@/api/devices/device.constants'
import { EXECUTION_TASK_ERROR_CODE } from '@/api/devices/execution-task.constants'
import { ExecutionTaskStatus } from '@/api/devices/execution-task.types'
import { PROJECT_ERROR_CODE } from '@/api/projects/project.constants'
import {
  formatCountdown,
  formatJsonBlock,
  getCapabilityLabelKey,
  getDeviceErrorKey,
  getRemainingSeconds,
  getTaskDurationSeconds,
  getTaskStatusClassName,
  isActiveTask,
  normalizeExecutionTaskList,
} from './devices.utils'

describe('normalizeExecutionTaskList', () => {
  it('从分页包装里取出数组', () => {
    const data = { list: [{ id: 't1' }], total: 1, page: 1, pageSize: 20, totalPages: 1 } as unknown as ExecutionTaskListData
    expect(normalizeExecutionTaskList(data)).toEqual([{ id: 't1' }])
  })

  /** 接口出错或结构不对时页面要拿到空数组，不能让它炸在 `.map` 上 */
  it('拿不到列表时一律给空数组', () => {
    expect(normalizeExecutionTaskList(null)).toEqual([])
    expect(normalizeExecutionTaskList(undefined)).toEqual([])
    expect(normalizeExecutionTaskList({ list: null } as unknown as ExecutionTaskListData)).toEqual([])
  })
})

describe('getDeviceErrorKey', () => {
  it('请求本身没到服务端时按网络错误处理', () => {
    expect(getDeviceErrorKey(null)).toBe('error.network')
    expect(getDeviceErrorKey(undefined)).toBe('error.network')
  })

  it('设备业务码翻成对应文案键', () => {
    expect(getDeviceErrorKey(DEVICE_ERROR_CODE.NotFound)).toBe('error.deviceNotFound')
    expect(getDeviceErrorKey(DEVICE_ERROR_CODE.Revoked)).toBe('error.deviceRevoked')
    expect(getDeviceErrorKey(DEVICE_ERROR_CODE.Offline)).toBe('error.deviceOffline')
    expect(getDeviceErrorKey(DEVICE_ERROR_CODE.LimitExceeded)).toBe('error.deviceLimitExceeded')
    expect(getDeviceErrorKey(DEVICE_ERROR_CODE.NameInvalid)).toBe('error.deviceNameInvalid')
    expect(getDeviceErrorKey(DEVICE_ERROR_CODE.PairingCodeGenerateFailed)).toBe('error.pairingCodeGenerateFailed')
  })

  it('工单业务码翻成对应文案键', () => {
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.NotFound)).toBe('error.taskNotFound')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.StatusInvalid)).toBe('error.taskStatusInvalid')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.TypeNotSupported)).toBe('error.taskTypeNotSupported')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.PayloadInvalid)).toBe('error.taskPayloadInvalid')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.CreateFailed)).toBe('error.taskCreateFailed')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.CancelNotAllowed)).toBe('error.taskCancelNotAllowed')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.RetryNotAllowed)).toBe('error.taskRetryNotAllowed')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.MaxAttemptsExceeded)).toBe('error.taskMaxAttemptsExceeded')
    expect(getDeviceErrorKey(EXECUTION_TASK_ERROR_CODE.ProjectMismatch)).toBe('error.taskProjectMismatch')
  })

  it('派工单时撞上的项目业务码也翻得出来', () => {
    expect(getDeviceErrorKey(PROJECT_ERROR_CODE.NotFound)).toBe('error.projectNotFound')
    expect(getDeviceErrorKey(PROJECT_ERROR_CODE.Archived)).toBe('error.projectArchived')
  })

  it('没收录的业务码退回未知错误', () => {
    expect(getDeviceErrorKey(999999)).toBe('error.unknown')
    expect(getDeviceErrorKey('999999')).toBe('error.unknown')
  })
})

describe('getCapabilityLabelKey', () => {
  it('已收录的能力给文案键', () => {
    expect(getCapabilityLabelKey('xhs')).toBe('capability.xhs')
    expect(getCapabilityLabelKey('wechat_channels')).toBe('capability.wechatChannels')
  })

  /** 插件上报的能力会随版本增加，没收录的直接显示原始值，不要显示成空白 */
  it('没收录的能力返回 null 交给调用方显示原值', () => {
    expect(getCapabilityLabelKey('job:sync_creator_notes')).toBeNull()
    expect(getCapabilityLabelKey('')).toBeNull()
  })
})

describe('isActiveTask', () => {
  it('待领取、已领取、执行中都算还在跑', () => {
    expect(isActiveTask(ExecutionTaskStatus.Pending)).toBe(true)
    expect(isActiveTask(ExecutionTaskStatus.Leased)).toBe(true)
    expect(isActiveTask(ExecutionTaskStatus.Running)).toBe(true)
  })

  /** 判错会让页面一直轮询下去 */
  it('已结束的状态不算', () => {
    expect(isActiveTask(ExecutionTaskStatus.Succeeded)).toBe(false)
    expect(isActiveTask(ExecutionTaskStatus.Failed)).toBe(false)
    expect(isActiveTask(ExecutionTaskStatus.Cancelled)).toBe(false)
  })
})

describe('getTaskStatusClassName', () => {
  it('每个状态都有自己的徽标样式', () => {
    const classNames = [
      ExecutionTaskStatus.Succeeded,
      ExecutionTaskStatus.Failed,
      ExecutionTaskStatus.Cancelled,
      ExecutionTaskStatus.Pending,
    ].map(getTaskStatusClassName)

    expect(new Set(classNames).size).toBe(4)
    expect(getTaskStatusClassName(ExecutionTaskStatus.Running)).toBe(getTaskStatusClassName(ExecutionTaskStatus.Leased))
  })

  /** 之前成功那一支写死过 emerald，亮色下对比度只有 3.43:1，必须走主题变量 */
  it('不再出现写死的颜色类名', () => {
    for (const status of Object.values(ExecutionTaskStatus))
      expect(getTaskStatusClassName(status)).not.toMatch(/emerald|red-\d|green-\d/)
  })
})

describe('getTaskDurationSeconds', () => {
  it('正常算出秒数并四舍五入', () => {
    expect(getTaskDurationSeconds('2026-09-21T10:00:00.000Z', '2026-09-21T10:00:42.400Z')).toBe(42)
  })

  it('没开始或没结束都返回 null', () => {
    expect(getTaskDurationSeconds(null, '2026-09-21T10:00:00.000Z')).toBeNull()
    expect(getTaskDurationSeconds('2026-09-21T10:00:00.000Z', null)).toBeNull()
  })

  /** 时间不可解析、或结束早于开始，宁可不显示也不要显示一个负数 */
  it('时间不合法或倒着走就返回 null', () => {
    expect(getTaskDurationSeconds('不是时间', '2026-09-21T10:00:00.000Z')).toBeNull()
    expect(getTaskDurationSeconds('2026-09-21T10:01:00.000Z', '2026-09-21T10:00:00.000Z')).toBeNull()
  })
})

describe('formatCountdown', () => {
  it('补零成 mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(9)).toBe('00:09')
    expect(formatCountdown(600)).toBe('10:00')
    expect(formatCountdown(59.9)).toBe('00:59')
  })

  it('负数按 0 处理，不显示 -1:-1', () => {
    expect(formatCountdown(-10)).toBe('00:00')
  })
})

describe('getRemainingSeconds', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('算出离到期还剩几秒', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T10:00:00.000Z'))
    expect(getRemainingSeconds('2026-09-21T10:02:30.000Z')).toBe(150)
  })

  it('已经过期就是 0', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T10:00:00.000Z'))
    expect(getRemainingSeconds('2026-09-21T09:59:00.000Z')).toBe(0)
  })

  it('没有到期时间或时间不合法都是 0', () => {
    expect(getRemainingSeconds(null)).toBe(0)
    expect(getRemainingSeconds(undefined)).toBe(0)
    expect(getRemainingSeconds('不是时间')).toBe(0)
  })
})

describe('formatJsonBlock', () => {
  it('缩进两格输出', () => {
    expect(formatJsonBlock({ ok: true })).toBe('{\n  "ok": true\n}')
  })

  it('空值输出空串', () => {
    expect(formatJsonBlock(null)).toBe('')
    expect(formatJsonBlock(undefined)).toBe('')
  })

  /** 循环引用会让 JSON.stringify 抛异常，页面不能因此白屏 */
  it('序列化不动时退回字符串', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatJsonBlock(circular)).toBe('[object Object]')
  })
})
