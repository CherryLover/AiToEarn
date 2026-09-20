import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { UserNotifySettingRepository } from '@yikart/mongodb'
import { describe, expect, it, vi } from 'vitest'
import { NotifyModule } from '../notify/notify.module'
import { NotifyService } from '../notify/notify.service'
import { SettingsNotifyController } from './settings-notify.controller'
import { SettingsModule } from './settings.module'

// 真 config 要跑命令行参数解析，测试里起不来，照仓库现有写法整个桩掉
vi.mock('../../config', () => ({ config: { notify: {} } }))

// 测试环境下 @Prop 拿不到类型元数据，照 manual-publish-notify.spec.ts 的写法桩掉
vi.mock('@nestjs/mongoose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@nestjs/mongoose')
  return { ...actual, Prop: () => () => undefined }
})

/**
 * 接线检查：新模块的依赖能不能被 Nest 解出来。
 *
 * 光靠编译通过看不出这一层——漏注册一个 provider、漏把模块加进 app.module，
 * 都是编译好好的、一启动就炸。
 *
 * `MongodbModule` 在真实应用里是 `@Global` 且导出全部 repository，这里照同样的形状搭个桩。
 *
 * 注意这里**只能用静态 import**：改成 `await import('@yikart/mongodb')` 会让 Nx 把 mongodb
 * 这个 lib 判定成「懒加载」，全应用里所有静态 import 它的地方立刻变成 lint 报错。
 */
@Global()
@Module({
  providers: [{ provide: UserNotifySettingRepository, useValue: { getByUserId: vi.fn(), upsertByUserId: vi.fn() } }],
  exports: [UserNotifySettingRepository],
})
class StubMongodbModule {}

describe('设置模块的接线', () => {
  it('settingsModule 和 NotifyModule 一起能起来，依赖都解得出来', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubMongodbModule, NotifyModule, SettingsModule],
    }).compile()

    expect(moduleRef.get(SettingsNotifyController)).toBeDefined()
    expect(moduleRef.get(NotifyService)).toBeDefined()
    await moduleRef.close()
  })

  it('没有数据库时 NotifyService 照样能起来：@Optional 注入不能变成硬依赖', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotifyModule],
    }).compile()

    expect(moduleRef.get(NotifyService).enabled).toBe(false)
    await moduleRef.close()
  })
})
