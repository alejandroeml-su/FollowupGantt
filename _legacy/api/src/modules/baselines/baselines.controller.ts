import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { BaselinesService } from './baselines.service';

@Controller('baselines')
export class BaselinesController {
  constructor(private readonly service: BaselinesService) {}

  @Get() findAll(@Query('project_id') p: string) { return this.service.findAll(p); }
  @Post()
  create(@Body() b: { project_id: string; name: string; notes?: string; user_id?: string }) {
    return this.service.create(b.project_id, b.name, b.notes ?? '', b.user_id);
  }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
  @Get(':id/variance') variance(@Param('id') id: string) { return this.service.variance(id); }
}
