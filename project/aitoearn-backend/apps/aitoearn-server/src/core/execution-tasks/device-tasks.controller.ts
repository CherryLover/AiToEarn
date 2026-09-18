import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Public } from '@yikart/aitoearn-auth'
import { ApiDoc, ParseObjectIdPipe } from '@yikart/common'
import { DeviceAuthGuard, GetDevice } from '../devices/device-auth.guard'
import { DeviceDoc } from '../devices/devices.service'
import { RenewTaskDto, ReportTaskDto, StartTaskDto } from './execution-tasks.dto'
import { ExecutionTasksService } from './execution-tasks.service'
import { ClaimTaskResultVo, TaskLeaseVo, TaskReportedVo, toClaimedTaskVo } from './execution-tasks.vo'

/**
 * 设备侧工单接口，走设备令牌。
 *
 * 整个控制器挂 @Public()（让认 JWT 的全局守卫放行）+ DeviceAuthGuard（真正的鉴权）。
 * 领活只走 HTTP，WebSocket 只是催办，网关挂了这里照常能用。
 */
@ApiTags('Devices/Device-API')
@Public()
@UseGuards(DeviceAuthGuard)
@Controller('/device-api/tasks')
export class DeviceTasksController {
  constructor(private readonly executionTasksService: ExecutionTasksService) {}

  @ApiDoc({
    summary: '领一个活',
    description: '没有可领的返回 task 为 null，不算错误。领到之后会拿到 leaseId，续租和回报都必须带上',
    response: ClaimTaskResultVo,
  })
  @Post('/claim')
  async claim(
    @GetDevice() device: DeviceDoc,
  ): Promise<ClaimTaskResultVo> {
    const task = await this.executionTasksService.claim(device)
    return ClaimTaskResultVo.create({ task: task ? toClaimedTaskVo(task) : null })
  }

  @ApiDoc({
    summary: '续租',
    description: '活还没干完就得在租约到期前续一次，leaseId 对不上或者已经过期一律拒绝',
    body: RenewTaskDto.schema,
    response: TaskLeaseVo,
  })
  @Post('/:id/renew')
  async renew(
    @GetDevice() device: DeviceDoc,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RenewTaskDto,
  ): Promise<TaskLeaseVo> {
    const task = await this.executionTasksService.renew(device, id, dto.leaseId)
    return TaskLeaseVo.create({
      id: task.id,
      status: task.status,
      leaseExpiresAt: task.leaseExpiresAt!,
    })
  }

  @ApiDoc({
    summary: '上报开始执行',
    description: 'leased → running，让网页那边看得出活已经跑起来了',
    body: StartTaskDto.schema,
    response: TaskLeaseVo,
  })
  @Post('/:id/start')
  async start(
    @GetDevice() device: DeviceDoc,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: StartTaskDto,
  ): Promise<TaskLeaseVo> {
    const task = await this.executionTasksService.start(device, id, dto.leaseId)
    return TaskLeaseVo.create({
      id: task.id,
      status: task.status,
      leaseExpiresAt: task.leaseExpiresAt!,
    })
  }

  @ApiDoc({
    summary: '回报结果',
    description: '必须带 leaseId。失败且还有重试次数会退避后重新排队，用尽则转失败',
    body: ReportTaskDto.schema,
    response: TaskReportedVo,
  })
  @Post('/:id/report')
  async report(
    @GetDevice() device: DeviceDoc,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ReportTaskDto,
  ): Promise<TaskReportedVo> {
    const task = await this.executionTasksService.report(device, id, dto)
    return TaskReportedVo.create({
      id: task.id,
      status: task.status,
      attempts: task.attempts,
      availableAt: task.availableAt,
    })
  }
}
