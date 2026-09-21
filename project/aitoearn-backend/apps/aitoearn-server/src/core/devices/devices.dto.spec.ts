/**
 * 设备上报的能力标识长什么样。
 *
 * 这条校验是配对和心跳整个请求的守门人：它把一个合法的能力挡掉，用户看到的是
 * 一句「参数验证失败」，完全看不出是哪个字段的问题。上线过一次这样的回归——
 * 插件开始上报 `job:echo` 之后，所有设备的配对和心跳全部被拒。
 */
import { describe, expect, it, vi } from 'vitest'
import { DeviceCapabilitySchema } from './devices.dto'

vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

describe('设备能力标识', () => {
  it('平台标识照常通过', () => {
    for (const capability of ['xhs', 'douyin', 'bilibili', 'wechat_channels'])
      expect(DeviceCapabilitySchema.safeParse(capability).success).toBe(true)
  })

  /** 插件从 2026-09 起会带上这一支，服务端建 auto 工单前靠它判断有没有机器会干 */
  it('job: 前缀加工单类型也通过', () => {
    for (const capability of ['job:echo', 'job:publish', 'job:claim_link', 'job:sync_creator_notes'])
      expect(DeviceCapabilitySchema.safeParse(capability).success).toBe(true)
  })

  /** 能力标识会直接进 Mongo 查询，放开的只是 job: 这一个前缀，不是冒号 */
  it('别的冒号写法一律拒', () => {
    for (const capability of ['task:publish', 'job:', 'job:Publish', 'job:job:echo', 'a:b:c', ':echo'])
      expect(DeviceCapabilitySchema.safeParse(capability).success).toBe(false)
  })

  it('大写、空格、超长的照旧拒', () => {
    for (const capability of ['XHS', 'wechat channels', '1xhs', '', 'x'.repeat(40)])
      expect(DeviceCapabilitySchema.safeParse(capability).success).toBe(false)
  })
})
