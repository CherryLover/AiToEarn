import { createZodDto } from '@yikart/common'
import { NotifyRuleType } from '@yikart/mongodb'
import { z } from 'zod'

const NotifyRuleDtoSchema = z.object({
  type: z.enum(NotifyRuleType).describe('规则类型。目前只有 draft_ready（AI 生成素材结束后通知）'),
  enabled: z.boolean().describe('这条规则开不开。关掉后对应的推送就不发了'),
})

const UpdateNotifySettingDtoSchema = z.object({
  enabled: z.boolean().default(false).describe(
    '推送总开关。**关掉表示一条都不推**，服务器的默认通道也不走；'
    + '开着但地址留空，才会退回服务器的默认通道',
  ),
  barkBaseUrl: z.string().trim().max(500).default('').describe(
    'Bark 推送地址，形如 https://<域名>/<设备key>/。只支持 http/https，指向内网或本机的地址会被拒。'
    + '**清空这一项等于不再用自己的通道，已保存的 key 会一并删掉**',
  ),
  barkKey: z.string().max(200).default('').describe(
    '请求头 bark-key 的值。**空字符串表示「不改」**，只有填了新值才会覆盖已保存的那个。'
    + '接口永远不会把这个值回传给前端',
  ),
  group: z.string().trim().max(50).default('AiToEarn').describe('通知分组，留空按 AiToEarn 处理'),
  rules: z.array(NotifyRuleDtoSchema).max(20).optional().describe(
    '通知规则，一条规则一个对象。不传表示这次不改规则',
  ),
})

export class UpdateNotifySettingDto extends createZodDto(UpdateNotifySettingDtoSchema, 'UpdateNotifySettingDto') {}
