import { createZodDto } from '@yikart/common'
import { AngleSource, AngleStatus } from '@yikart/mongodb'
import { z } from 'zod'

const AngleVoSchema = z.object({
  id: z.string().describe('方向 ID'),
  projectId: z.string().describe('所属项目 ID'),
  slug: z.string().describe('方向 slug，同时是 angles/<slug>.md 的文件名'),
  name: z.string().describe('显示名'),
  desc: z.string().nullable().describe('这个方向切什么痛点、什么噱头'),
  source: z.enum(AngleSource).describe('方向怎么来的：ai 提炼 / user 手建 / derived 派生'),
  parentAngleId: z.string().nullable().describe('血统：从哪个方向派生来的，空表示这是一条线的起点'),
  status: z.enum(AngleStatus).describe('方向状态'),
  sourceAssetPaths: z.array(z.string()).describe('提炼时吃了哪些背景物料，相对项目根'),
  promptSnapshot: z.string().nullable().describe('提炼时用的提示词'),
  filePath: z.string().describe('写作指引文件路径，相对项目根；正文用物料文件接口读写'),
  confirmedAt: z.coerce.date().optional().describe('人确认采用的时间；没有这个字段表示还在待确认区里等人看'),
  createdAt: z.coerce.date().describe('创建时间'),
  updatedAt: z.coerce.date().describe('更新时间'),
})
export class AngleVo extends createZodDto(AngleVoSchema, 'AngleVo') {}

export interface AngleTreeNodeShape extends z.infer<typeof AngleVoSchema> {
  children: AngleTreeNodeShape[]
}

/** 方向演进树的一个节点：方向本身 + 它底下派生出来的子方向 */
const AngleTreeNodeVoSchema: z.ZodType<AngleTreeNodeShape> = z.lazy(() => AngleVoSchema.extend({
  children: z.array(AngleTreeNodeVoSchema).describe('从这个方向派生出来的子方向，按创建时间正序'),
}))
export class AngleTreeNodeVo extends createZodDto(AngleTreeNodeVoSchema, 'AngleTreeNodeVo') {}

const AngleDeletedVoSchema = z.object({
  id: z.string().describe('已删除的方向 ID'),
  slug: z.string().describe('已删除的方向 slug'),
  filePath: z.string().describe('一并删掉的写作指引文件路径'),
})
export class AngleDeletedVo extends createZodDto(AngleDeletedVoSchema, 'AngleDeletedVo') {}
