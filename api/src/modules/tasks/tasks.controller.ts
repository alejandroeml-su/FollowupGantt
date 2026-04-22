import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get() findAll(@Query('project_id') projectId?: string) {
    return this.service.findAll(projectId);
  }
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() create(@Body() body: any) { return this.service.create(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }

  @Patch(':id/move')
  move(@Param('id') id: string, @Body() body: { column_id: string; position: number }) {
    return this.service.moveToColumn(id, body.column_id, body.position);
  }
}
