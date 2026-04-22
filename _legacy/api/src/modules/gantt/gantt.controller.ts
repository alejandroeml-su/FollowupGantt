import { Controller, Get, Query } from '@nestjs/common';
import { GanttService } from './gantt.service';

@Controller('gantt')
export class GanttController {
  constructor(private readonly service: GanttService) {}
  @Get('timeline') timeline(@Query('project_id') p: string) { return this.service.timeline(p); }
}
