import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import { angleRelPath } from './angle-slug.util'
import { AngleTreeNode } from './angle-tree.util'
import { AngleListQueryDto, CreateAngleDto, DeriveAngleDto, UpdateAngleDto } from './angles.dto'
import { AngleDoc, AnglesService } from './angles.service'
import { AngleDeletedVo, AngleTreeNodeShape, AngleTreeNodeVo, AngleVo } from './angles.vo'

function toAngleShape(angle: AngleDoc) {
  return {
    id: angle.id,
    projectId: angle.projectId,
    slug: angle.slug,
    name: angle.name,
    desc: angle.desc ?? null,
    source: angle.source,
    parentAngleId: angle.parentAngleId ?? null,
    status: angle.status,
    sourceAssetPaths: angle.sourceAssetPaths ?? [],
    promptSnapshot: angle.promptSnapshot ?? null,
    filePath: angleRelPath(angle.slug),
    createdAt: angle.createdAt,
    updatedAt: angle.updatedAt,
  }
}

function toAngleVo(angle: AngleDoc): AngleVo {
  return AngleVo.create(toAngleShape(angle))
}

function toTreeShape(node: AngleTreeNode<AngleDoc>): AngleTreeNodeShape {
  return {
    ...toAngleShape(node.angle),
    children: node.children.map(child => toTreeShape(child)),
  }
}

@ApiTags('Projects/Angles')
@Controller('/projects/:projectId/angles')
export class AnglesController {
  constructor(private readonly anglesService: AnglesService) {}

  @ApiDoc({
    summary: '方向列表',
    description: '方向是待验证的假设，不是预先定死的分类；可按状态过滤',
    query: AngleListQueryDto.schema,
    response: [AngleVo],
  })
  @Get('/list')
  async list(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: AngleListQueryDto,
  ): Promise<AngleVo[]> {
    const angles = await this.anglesService.list(projectId, token.id, query.status)
    return angles.map(angle => toAngleVo(angle))
  }

  @ApiDoc({
    summary: '方向演进树',
    description: '按血统（parentAngleId）组装成树，一眼看出哪条线在往下长；父方向缺失的节点会被提到根上',
    response: [AngleTreeNodeVo],
  })
  @Get('/tree')
  async tree(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
  ): Promise<AngleTreeNodeVo[]> {
    const nodes = await this.anglesService.tree(projectId, token.id)
    return nodes.map(node => AngleTreeNodeVo.create(toTreeShape(node)))
  }

  @ApiDoc({
    summary: '手建一个方向',
    description: 'slug 同时是 angles/<slug>.md 的文件名；写作指引正文写进该文件，元信息和血统留在数据库',
    body: CreateAngleDto.schema,
    response: AngleVo,
  })
  @Post('/create')
  async create(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: CreateAngleDto,
  ): Promise<AngleVo> {
    const angle = await this.anglesService.create(projectId, token.id, dto)
    return toAngleVo(angle)
  }

  @ApiDoc({
    summary: '登记 AI 写出来的方向文件',
    description: '扫 angles/ 下的 .md，把还没入库的方向登记进来（来源默认 ai，血统按 frontmatter 里的 parent 连）；已登记的不动',
    response: [AngleVo],
  })
  @Post('/sync')
  async sync(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
  ): Promise<AngleVo[]> {
    const angles = await this.anglesService.syncFromFiles(projectId, token.id)
    return angles.map(angle => toAngleVo(angle))
  }

  @ApiDoc({
    summary: '更新方向',
    description: '能改显示名、说明、状态、slug 和父方向；slug 改了会同步把文件改名，文件改名失败会把数据库改回去',
    body: UpdateAngleDto.schema,
    response: AngleVo,
  })
  @Post('/:angleId/update')
  async update(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('angleId', ParseObjectIdPipe) angleId: string,
    @Body() dto: UpdateAngleDto,
  ): Promise<AngleVo> {
    const angle = await this.anglesService.update(projectId, angleId, token.id, dto)
    return toAngleVo(angle)
  }

  @ApiDoc({
    summary: '从这个方向派生一个子方向',
    description: 'source 固定 derived，parentAngleId 自动填当前方向；不传正文就继承父方向的写作指引当起点',
    body: DeriveAngleDto.schema,
    response: AngleVo,
  })
  @Post('/:angleId/derive')
  async derive(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('angleId', ParseObjectIdPipe) angleId: string,
    @Body() dto: DeriveAngleDto,
  ): Promise<AngleVo> {
    const angle = await this.anglesService.derive(projectId, angleId, token.id, dto)
    return toAngleVo(angle)
  }

  @ApiDoc({
    summary: '删除方向',
    description: '同时删掉 angles/<slug>.md；名下还有子方向时不让删，先处理子方向',
    response: AngleDeletedVo,
  })
  @Delete('/:angleId')
  async remove(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('angleId', ParseObjectIdPipe) angleId: string,
  ): Promise<AngleDeletedVo> {
    const deleted = await this.anglesService.remove(projectId, angleId, token.id)
    return AngleDeletedVo.create(deleted)
  }
}
