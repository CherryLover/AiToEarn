import { Module } from '@nestjs/common'
import { DevicesModule } from '../devices/devices.module'
import { DeviceTasksController } from './device-tasks.controller'
import { DeviceWsGateway } from './device-ws.gateway'
import { ExecutionTaskReaper } from './execution-task.reaper'
import { ExecutionTasksController } from './execution-tasks.controller'
import { ExecutionTasksService } from './execution-tasks.service'

@Module({
  imports: [DevicesModule],
  controllers: [ExecutionTasksController, DeviceTasksController],
  providers: [ExecutionTasksService, ExecutionTaskReaper, DeviceWsGateway],
  exports: [ExecutionTasksService],
})
export class ExecutionTasksModule {}
