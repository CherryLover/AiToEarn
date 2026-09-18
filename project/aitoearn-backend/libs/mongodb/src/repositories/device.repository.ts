import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Device, DeviceAccount, DeviceStatus } from '../schemas'
import { BaseRepository } from './base.repository'

/** 心跳带上来的字段，只有传了的才覆盖 */
export interface DeviceHeartbeatPatch {
  status?: DeviceStatus
  capabilities?: string[]
  accounts?: DeviceAccount[]
  version?: string
  platform?: string
}

@Injectable()
export class DeviceRepository extends BaseRepository<Device> {
  constructor(
    @InjectModel(Device.name) deviceModel: Model<Device>,
  ) {
    super(deviceModel)
  }

  /** 按令牌哈希查设备。已吊销的查不到，令牌立即失效靠这一条 */
  async getByTokenHash(tokenHash: string) {
    return await this.findOne({ tokenHash, revokedAt: { $exists: false } })
  }

  /** 拿一台属于该用户、且没被吊销的设备 */
  async getByIdAndUserId(id: string, userId: string) {
    return await this.findOne({ _id: id, userId, revokedAt: { $exists: false } })
  }

  /** 列出用户还在用的设备，最近配对的在前 */
  async listByUserId(userId: string) {
    return await this.find(
      { userId, revokedAt: { $exists: false } },
      { sort: { createdAt: -1 } },
    )
  }

  /** 用户名下还没吊销的设备数量 */
  async countByUserId(userId: string): Promise<number> {
    return await this.count({ userId, revokedAt: { $exists: false } })
  }

  /** 刷新心跳，顺带覆盖上报上来的能力和账号 */
  async updateHeartbeatById(id: string, patch: DeviceHeartbeatPatch = {}) {
    const update: Partial<Device> = {
      lastSeenAt: new Date(),
      status: patch.status ?? DeviceStatus.ONLINE,
    }
    if (patch.capabilities !== undefined)
      update.capabilities = patch.capabilities
    if (patch.accounts !== undefined)
      update.accounts = patch.accounts
    if (patch.version !== undefined)
      update.version = patch.version
    if (patch.platform !== undefined)
      update.platform = patch.platform

    return await this.updateById(id, update)
  }

  async updateNameById(id: string, name: string) {
    return await this.updateById(id, { name })
  }

  /** 吊销：令牌立即失效，设备不再出现在列表里，但历史工单上的 deviceId 仍能查到它 */
  async updateAsRevokedById(id: string) {
    return await this.updateById(id, {
      revokedAt: new Date(),
      status: DeviceStatus.OFFLINE,
    })
  }
}
