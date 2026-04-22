import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { DependenciesService } from './dependencies.service';

@Controller('dependencies')
export class DependenciesController {
  constructor(private readonly service: DependenciesService) {}
  @Get() findAll(@Query('project_id') p?: string) { return this.service.findAll(p); }
  @Post() create(@Body() b: any) { return this.service.create(b); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
