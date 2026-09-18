import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import {
  CompletePublishedPostDto,
  CreateFromDraftDto,
  FailPublishedPostDto,
  PublishedPostListQueryDto,
} from './publishing.dto'
import { PublishingService } from './publishing.service'
import {
  PublishedPostDeletedVo,
  PublishedPostDetailVo,
  PublishedPostListVo,
  PublishJobCreatedVo,
  toPublishedPostDetailVo,
  toPublishedPostListItemVo,
  toPublishJobCreatedVo,
} from './publishing.vo'

/**
 * 手动发布闭环。
 *
 * **这一轮不做真实发布**：接口只负责把草稿打包成一张可以拿去发的卡片，
 * 以及人发完之后回来登记。这里不会调用任何平台的发布接口。
 */
@ApiTags('Projects/Publishing')
@Controller('/projects/:projectId/publishing')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @ApiDoc({
    summary: '从草稿建发布工单',
    description: '读草稿文件抄下内容快照，建一条发布记录和一张手动工单。'
      + 'mode 这一轮只接受 manual，传 auto 直接拒绝——自动发布要执行端插件，还没有。'
      + '返回里带着这份草稿的三条提示：哪些图没能带进快照、有没有声明配图、正文是不是整篇原文兜出来的',
    body: CreateFromDraftDto.schema,
    response: PublishJobCreatedVo,
  })
  @Post('/from-draft')
  async createFromDraft(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: CreateFromDraftDto,
  ): Promise<PublishJobCreatedVo> {
    const { post, ...notes } = await this.publishingService.createFromDraft(projectId, token.id, dto)
    return toPublishJobCreatedVo(post, notes)
  }

  @ApiDoc({
    summary: '发布记录列表',
    description: '可按方向、平台、发布状态、链接状态筛。发布状态和链接状态是两个维度，别合成一个看',
    query: PublishedPostListQueryDto.schema,
    response: PublishedPostListVo,
  })
  @Get('/list')
  async listWithPagination(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: PublishedPostListQueryDto,
  ): Promise<PublishedPostListVo> {
    const { list, total } = await this.publishingService.listWithPagination(projectId, token.id, query)
    return new PublishedPostListVo(list.map(post => toPublishedPostListItemVo(post)), total, query)
  }

  @ApiDoc({
    summary: '发布记录详情',
    description: '含完整内容快照：标题、正文、话题、图片地址',
    response: PublishedPostDetailVo,
  })
  @Get('/:id')
  async getDetail(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PublishedPostDetailVo> {
    const post = await this.publishingService.getDetail(projectId, id, token.id)
    return toPublishedPostDetailVo(post)
  }

  @ApiDoc({
    summary: '人工回填帖子链接',
    description: '你自己发完之后回来贴链接：记录转 published + claimed，对应的工单转 succeeded。'
      + '同一个平台上的同一条帖子只能登记一次',
    body: CompletePublishedPostDto.schema,
    response: PublishedPostDetailVo,
  })
  @Post('/:id/complete')
  async complete(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CompletePublishedPostDto,
  ): Promise<PublishedPostDetailVo> {
    const post = await this.publishingService.complete(projectId, id, token.id, dto)
    return toPublishedPostDetailVo(post)
  }

  @ApiDoc({
    summary: '人工标记发失败',
    description: '记录转 failed 并记下原因，对应的手动工单一并取消',
    body: FailPublishedPostDto.schema,
    response: PublishedPostDetailVo,
  })
  @Post('/:id/fail')
  async fail(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FailPublishedPostDto,
  ): Promise<PublishedPostDetailVo> {
    const post = await this.publishingService.fail(projectId, id, token.id, dto)
    return toPublishedPostDetailVo(post)
  }

  @ApiDoc({
    summary: '删掉这条登记',
    description: '只删发布记录和对应的执行工单，草稿文件一个字都不动',
    response: PublishedPostDeletedVo,
  })
  @Delete('/:id')
  async remove(
    @GetToken() token: TokenInfo,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PublishedPostDeletedVo> {
    const removed = await this.publishingService.remove(projectId, id, token.id)
    return PublishedPostDeletedVo.create(removed)
  }
}
