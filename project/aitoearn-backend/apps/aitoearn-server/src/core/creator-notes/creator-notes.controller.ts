import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import { ExecutionTaskDetailVo, toExecutionTaskDetailVo } from '../execution-tasks/execution-tasks.vo'
import {
  AdoptCreatorNoteRowDto,
  ClaimCreatorNoteRowDto,
  CreateSyncTaskDto,
  CreatorNoteRowListQueryDto,
  ProjectMetricsQueryDto,
} from './creator-notes.dto'
import { CreatorNotesService } from './creator-notes.service'
import {
  AngleMetricTotalVo,
  CreatorNoteRowListVo,
  CreatorNoteRowVo,
  PostMetricPointVo,
  PostMetricTrendVo,
  toAngleMetricTotalVo,
  toCreatorNoteRowVo,
  toPostMetricPointVo,
  toPostMetricTrendVo,
} from './creator-notes.vo'

/** 创作平台采回来的数据：落地表、归属、以及数据页要的那几个聚合 */
@ApiTags('Creator-Notes')
@Controller('/creator-notes')
export class CreatorNotesController {
  constructor(private readonly creatorNotesService: CreatorNotesService) {}

  @ApiDoc({
    summary: '立刻采一次',
    description: '建一个 sync_creator_notes 工单，派给名下声明了这个平台的机器。采集规格由服务端下发，不用填',
    body: CreateSyncTaskDto.schema,
    response: ExecutionTaskDetailVo,
  })
  @Post('/sync')
  async createSyncTask(
    @GetToken() token: TokenInfo,
    @Body() dto: CreateSyncTaskDto,
  ): Promise<ExecutionTaskDetailVo> {
    const task = await this.creatorNotesService.createSyncTask(token.id, dto)
    return toExecutionTaskDetailVo(task)
  }

  @ApiDoc({
    summary: '采回来的数据行',
    description: '可按平台、账号、归属状态筛。「未归属的帖子」那一块传 matchState=unmatched',
    query: CreatorNoteRowListQueryDto.schema,
    response: CreatorNoteRowListVo,
  })
  @Get('/rows')
  async listRowsWithPagination(
    @GetToken() token: TokenInfo,
    @Query() query: CreatorNoteRowListQueryDto,
  ): Promise<CreatorNoteRowListVo> {
    const { list, total } = await this.creatorNotesService.listRowsWithPagination(token.id, query)
    return new CreatorNoteRowListVo(list.map(toCreatorNoteRowVo), total, query)
  }

  @ApiDoc({
    summary: '认领一行未归属的数据',
    description: '把这一行归到某条发布记录上，并立刻补一个指标快照，不用等下一次采集',
    body: ClaimCreatorNoteRowDto.schema,
    response: CreatorNoteRowVo,
  })
  @Post('/rows/:id/claim')
  async claimRow(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ClaimCreatorNoteRowDto,
  ): Promise<CreatorNoteRowVo> {
    const row = await this.creatorNotesService.claimRow(token.id, id, dto)
    return CreatorNoteRowVo.create(toCreatorNoteRowVo(row))
  }

  @ApiDoc({
    summary: '把一行未归属的数据建成发布记录',
    description: '用在「这条内容是我自己做的，只是一开始没走系统」：建一条 source=discovered 的发布记录并立刻归属过去。列表页上没有正文，建出来的记录正文是空的',
    body: AdoptCreatorNoteRowDto.schema,
    response: CreatorNoteRowVo,
  })
  @Post('/rows/:id/adopt')
  async adoptRow(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdoptCreatorNoteRowDto,
  ): Promise<CreatorNoteRowVo> {
    const row = await this.creatorNotesService.adoptRow(token.id, id, dto)
    return CreatorNoteRowVo.create(toCreatorNoteRowVo(row))
  }

  @ApiDoc({
    summary: '一条帖子的时间序列',
    description: '那几次快照连成的折线，早的在前',
    response: [PostMetricPointVo],
  })
  @Get('/posts/:id/series')
  async listSeries(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PostMetricPointVo[]> {
    const series = await this.creatorNotesService.listSeriesByPublishedPostId(token.id, id)
    return series.map(metric => PostMetricPointVo.create(toPostMetricPointVo(metric)))
  }

  @ApiDoc({
    summary: '项目下每条帖子的当前值和趋势',
    description: 'delta 是跟上一个采集点的差；只采过一次的帖子没有 delta。按发布时间倒序，最新发的在最前',
    query: ProjectMetricsQueryDto.schema,
    response: [PostMetricTrendVo],
  })
  @Get('/projects/:projectId/trends')
  async listProjectTrends(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: ProjectMetricsQueryDto,
  ): Promise<PostMetricTrendVo[]> {
    const trends = await this.creatorNotesService.listProjectTrends(token.id, projectId, query)
    return trends.map(trend => PostMetricTrendVo.create(toPostMetricTrendVo(trend)))
  }

  @ApiDoc({
    summary: '按方向汇总',
    description: '每条帖子取最新那一条快照再按方向加起来。累加所有快照会得到一个既不是当前值也不是增量的数，所以这里只取最新',
    query: ProjectMetricsQueryDto.schema,
    response: [AngleMetricTotalVo],
  })
  @Get('/projects/:projectId/angle-totals')
  async listAngleTotals(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: ProjectMetricsQueryDto,
  ): Promise<AngleMetricTotalVo[]> {
    const totals = await this.creatorNotesService.listAngleTotals(token.id, projectId, query)
    return totals.map(total => AngleMetricTotalVo.create(toAngleMetricTotalVo(total)))
  }
}
