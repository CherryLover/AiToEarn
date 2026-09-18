import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import {
  CompleteManualTaskDto,
  CreateEchoTaskDto,
  ExecutionTaskListQueryDto,
} from './execution-tasks.dto'
import { ExecutionTasksService } from './execution-tasks.service'
import {
  ExecutionTaskDetailVo,
  ExecutionTaskListVo,
  toExecutionTaskDetailVo,
  toExecutionTaskListItemVo,
} from './execution-tasks.vo'

/** 管理侧：网页登录后用，看自己名下的工单 */
@ApiTags('Execution-Tasks')
@Controller('/execution-tasks')
export class ExecutionTasksController {
  constructor(private readonly executionTasksService: ExecutionTasksService) {}

  @ApiDoc({
    summary: '工单列表',
    description: '可按项目、发布方向、类型、模式、状态、执行设备筛',
    query: ExecutionTaskListQueryDto.schema,
    response: ExecutionTaskListVo,
  })
  @Get('/list')
  async listWithPagination(
    @GetToken() token: TokenInfo,
    @Query() query: ExecutionTaskListQueryDto,
  ): Promise<ExecutionTaskListVo> {
    const { list, total } = await this.executionTasksService.listWithPagination({
      userId: token.id,
      ...query,
    })
    return new ExecutionTaskListVo(list.map(toExecutionTaskListItemVo), total, query)
  }

  @ApiDoc({
    summary: '建一个 echo 工单',
    description: '打通链路用的最小工单：设备领走后原样返回 message。链路有没有通，看这个最直接',
    body: CreateEchoTaskDto.schema,
    response: ExecutionTaskDetailVo,
  })
  @Post('/create-echo')
  async createEcho(
    @GetToken() token: TokenInfo,
    @Body() dto: CreateEchoTaskDto,
  ): Promise<ExecutionTaskDetailVo> {
    const task = await this.executionTasksService.createEcho(token.id, dto)
    return toExecutionTaskDetailVo(task)
  }

  @ApiDoc({
    summary: '工单详情',
    description: '含载荷和结果',
    response: ExecutionTaskDetailVo,
  })
  @Get('/:id')
  async getDetail(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ExecutionTaskDetailVo> {
    const task = await this.executionTasksService.getDetail(id, token.id)
    return toExecutionTaskDetailVo(task)
  }

  @ApiDoc({
    summary: '取消工单',
    description: '已经是终态的取消不了。正在设备上跑的会被取消，设备回报时会被拒',
    response: ExecutionTaskDetailVo,
  })
  @Post('/:id/cancel')
  async cancel(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ExecutionTaskDetailVo> {
    const task = await this.executionTasksService.cancel(id, token.id)
    return toExecutionTaskDetailVo(task)
  }

  @ApiDoc({
    summary: '重试失败的工单',
    description: '只有失败的能重试，重试后尝试次数归零',
    response: ExecutionTaskDetailVo,
  })
  @Post('/:id/retry')
  async retry(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ExecutionTaskDetailVo> {
    const task = await this.executionTasksService.retry(id, token.id)
    return toExecutionTaskDetailVo(task)
  }

  @ApiDoc({
    summary: '人工回填手动工单的结果',
    description: '只有 manual 模式的待办工单能这样完成，回填后直接转成功',
    body: CompleteManualTaskDto.schema,
    response: ExecutionTaskDetailVo,
  })
  @Post('/:id/manual-complete')
  async completeManual(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CompleteManualTaskDto,
  ): Promise<ExecutionTaskDetailVo> {
    const task = await this.executionTasksService.completeManual(id, token.id, dto.result)
    return toExecutionTaskDetailVo(task)
  }
}
