import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import { Project } from '@yikart/mongodb'
import { CreateProjectDto, ProjectListQueryDto, UpdateProjectDto } from './projects.dto'
import { ProjectsService } from './projects.service'
import { ProjectDetailVo, ProjectListItemVo, SuggestNameVo } from './projects.vo'

type ProjectDoc = Pick<
  Project,
  'id' | 'name' | 'displayName' | 'desc' | 'audience' | 'goal' | 'status' | 'dirName' | 'archivedAt' | 'createdAt' | 'updatedAt'
>

function toDetailVo(project: ProjectDoc): ProjectDetailVo {
  return ProjectDetailVo.create({
    id: project.id,
    name: project.name,
    displayName: project.displayName,
    desc: project.desc ?? null,
    audience: project.audience ?? null,
    goal: project.goal ?? null,
    status: project.status,
    dirName: project.dirName,
    archivedAt: project.archivedAt ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  })
}

@ApiTags('Projects')
@Controller('/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @ApiDoc({
    summary: '创建项目',
    description: '英文名同时是服务器上的目录名，创建后不可修改；创建成功时物料目录已经建好',
    body: CreateProjectDto.schema,
    response: ProjectDetailVo,
  })
  @Post('/create')
  async create(
    @GetToken() token: TokenInfo,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.create(token.id, dto)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '获取项目列表',
    query: ProjectListQueryDto.schema,
    response: [ProjectListItemVo],
  })
  @Get('/list')
  async list(
    @GetToken() token: TokenInfo,
    @Query() query: ProjectListQueryDto,
  ): Promise<ProjectListItemVo[]> {
    const projects = await this.projectsService.listByUserId(token.id, query.status)
    return projects.map(project => ProjectListItemVo.create({
      id: project.id,
      name: project.name,
      displayName: project.displayName,
      desc: project.desc ?? null,
      status: project.status,
      createdAt: project.createdAt,
    }))
  }

  @ApiDoc({
    summary: '获取一个可用的建议英文名',
    description: '返回「形容词-名词」形式的可读名字，已经查过重',
    response: SuggestNameVo,
  })
  @Get('/suggest-name')
  async suggestName(
    @GetToken() _token: TokenInfo,
  ): Promise<SuggestNameVo> {
    const name = await this.projectsService.suggestName()
    return SuggestNameVo.create({ name })
  }

  @ApiDoc({
    summary: '获取项目详情',
    response: ProjectDetailVo,
  })
  @Get('/:id')
  async detail(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.getDetail(id, token.id)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '更新项目',
    description: '只能改显示名、说明、面向谁、想达成什么；带上 name 会被忽略',
    body: UpdateProjectDto.schema,
    response: ProjectDetailVo,
  })
  @Post('/:id/update')
  async update(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.update(id, token.id, dto)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '归档项目',
    description: '目录改名为 _archived_<英文名>_<时间戳>，文件不删',
    response: ProjectDetailVo,
  })
  @Post('/:id/archive')
  async archive(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.archive(id, token.id)
    return toDetailVo(project)
  }
}
