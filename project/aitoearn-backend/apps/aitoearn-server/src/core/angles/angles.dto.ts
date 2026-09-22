import { createZodDto } from '@yikart/common'
import { AngleStatus } from '@yikart/mongodb'
import { z } from 'zod'

const AngleListQueryDtoSchema = z.object({
  status: z.enum(AngleStatus).optional().describe('按状态过滤：candidate / testing / effective / retired，不传则全部返回'),
  confirmed: z.stringbool().optional().describe('按确认与否过滤：true 只看人已经采用的，false 只看 AI 刚提还没人看过的，不传则全部返回'),
})
export class AngleListQueryDto extends createZodDto(AngleListQueryDtoSchema, 'AngleListQueryDto') {}

/** 批量采用待确认的方向。id 里只要有一个不属于这个项目就整单拒绝，不做「能采几条算几条」 */
const ConfirmAnglesDtoSchema = z.object({
  angleIds: z.array(z.string()).min(1).max(200).describe('要采用的方向 ID 列表；重复的会去重，已确认的再传一次不报错也不刷新时间'),
})
export class ConfirmAnglesDto extends createZodDto(ConfirmAnglesDtoSchema, 'ConfirmAnglesDto') {}

const CreateAngleDtoSchema = z.object({
  slug: z.string().describe('方向 slug，同时是 angles/<slug>.md 的文件名。规则同项目英文名，但允许后续修改'),
  name: z.string().min(1).max(60).describe('显示名，可中文'),
  desc: z.string().max(500).optional().describe('这个方向切什么痛点、什么噱头'),
  status: z.enum(AngleStatus).optional().describe('初始状态，默认 candidate'),
  guide: z.string().optional().describe('写作指引正文，写进 angles/<slug>.md；不传则写一段占位说明，不替你编'),
})
export class CreateAngleDto extends createZodDto(CreateAngleDtoSchema, 'CreateAngleDto') {}

/**
 * 更新方向。
 * slug 允许改（改了会同步改文件名，文件改名失败会把数据库回滚回去）；
 * `parentAngleId` 传 null 表示把这个方向从血统里摘出来，自己变成一条线的起点。
 */
const UpdateAngleDtoSchema = z.object({
  slug: z.string().optional().describe('新的 slug，改了会同步把 angles/<slug>.md 改名'),
  name: z.string().min(1).max(60).optional().describe('显示名'),
  desc: z.string().max(500).optional().describe('这个方向切什么痛点、什么噱头'),
  status: z.enum(AngleStatus).optional().describe('方向状态'),
  parentAngleId: z.string().nullable().optional().describe('改挂到哪个父方向下；传 null 表示摘成独立起点'),
  guide: z.string().optional().describe('写作指引正文，覆盖写进 angles/<slug>.md；不传则只改 frontmatter，正文保持原样'),
})
export class UpdateAngleDto extends createZodDto(UpdateAngleDtoSchema, 'UpdateAngleDto') {}

/** 从一个方向派生子方向：`source` 固定 derived，`parentAngleId` 由服务端填，不接受传入 */
const DeriveAngleDtoSchema = z.object({
  slug: z.string().describe('新方向的 slug，同时是 angles/<slug>.md 的文件名'),
  name: z.string().min(1).max(60).describe('显示名，可中文'),
  desc: z.string().max(500).optional().describe('这一层往下深入什么'),
  guide: z.string().optional().describe('写作指引正文；不传则继承父方向的正文作为起点'),
})
export class DeriveAngleDto extends createZodDto(DeriveAngleDtoSchema, 'DeriveAngleDto') {}
