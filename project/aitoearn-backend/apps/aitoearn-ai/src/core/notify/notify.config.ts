import { z } from 'zod'

/**
 * Bark 推送配置（阶段 4，contract-stage4 第二节）。
 *
 * 仓库里只放空占位：真实地址和 key 只写在服务器的 `/opt/stack/aitoearn/.env`，
 * 由 `deploy/oci/overrides/*.yaml` 里的 `${NOTIFY_*}` 渲染进配置，绝不进仓库。
 *
 * 默认全关：没配就静默跳过，不抛错、不刷日志。
 *
 * 注意：这份 schema 在 `apps/aitoearn-server/src/core/notify/notify.config.ts` 有一份完全相同的副本。
 * 两个应用之间没有共享代码的 lib（参照 `project-workspace.service.ts` 的同款处理），改动时必须同步。
 */
export const notifyConfigSchema = z.object({
  enabled: z.boolean().default(false).describe('推送总开关，没配就静默关掉，不报错'),
  barkUrl: z.string().default('').describe('Bark 推送地址，形如 https://notify.example.com/<设备key>/'),
  barkKey: z.string().default('').describe('请求头 bark-key 的值'),
  group: z.string().default('AiToEarn').describe('通知分组'),
}).default({ enabled: false, barkUrl: '', barkKey: '', group: 'AiToEarn' })

export type NotifyConfig = z.infer<typeof notifyConfigSchema>
