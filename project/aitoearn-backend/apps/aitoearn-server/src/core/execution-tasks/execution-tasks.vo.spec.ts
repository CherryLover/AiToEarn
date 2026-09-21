/**
 * 设备把业务码写在失败信息最前面，VO 要把它解出来。
 *
 * 工单回报失败只有 `error` 一个字符串字段，设备要传一个可判别的类型只能借它。
 * 解错了的后果是网页只能原样显示一句中文，没法按类型给引导（去登录 / 更新采集规格）。
 */
import { ExecutionTaskMode, ExecutionTaskStatus, ExecutionTaskType } from '@yikart/mongodb'
import { describe, expect, it, vi } from 'vitest'
import { toExecutionTaskListItemVo } from './execution-tasks.vo'

vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

function task(error?: string) {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    type: ExecutionTaskType.SYNC_CREATOR_NOTES,
    mode: ExecutionTaskMode.AUTO,
    status: ExecutionTaskStatus.FAILED,
    error,
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date('2026-09-21T02:00:00.000Z'),
    priority: 100,
    createdAt: new Date('2026-09-21T02:00:00.000Z'),
    updatedAt: new Date('2026-09-21T02:00:00.000Z'),
  } as never
}

describe('工单失败信息里的业务码', () => {
  it('解出码，展示的那份不再带方括号', () => {
    const vo = toExecutionTaskListItemVo(task('[20701] 那台机器上没登录小红书，先在浏览器里登录一次'))

    expect(vo.errorCode).toBe(20701)
    expect(vo.error).toBe('那台机器上没登录小红书，先在浏览器里登录一次')
  })

  it('没带码的照原样给出去，码是 null', () => {
    const vo = toExecutionTaskListItemVo(task('租约超时没有续租，设备可能已经离线'))

    expect(vo.errorCode).toBeNull()
    expect(vo.error).toBe('租约超时没有续租，设备可能已经离线')
  })

  it('只认开头那一处五位数，正文里出现的数字不当码', () => {
    const vo = toExecutionTaskListItemVo(task('采了 20703 条，但都没归属'))

    expect(vo.errorCode).toBeNull()
    expect(vo.error).toBe('采了 20703 条，但都没归属')
  })

  it('没失败的工单两项都是 null', () => {
    const vo = toExecutionTaskListItemVo(task(undefined))

    expect(vo.errorCode).toBeNull()
    expect(vo.error).toBeNull()
  })
})
