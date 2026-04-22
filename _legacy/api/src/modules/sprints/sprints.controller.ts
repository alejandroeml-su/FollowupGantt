import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SprintsService } from './sprints.service';

@Controller('sprints')
export class SprintsController {
  constructor(private readonly service: SprintsService) {}
  @Get() findAll(@Query('project_id') p?: string) { return this.service.findAll(p); }
  @Post() create(@Body() b: any) { return this.service.create(b); }
  @Patch(':id') update(@Param('id') id: string, @Body() b: any) { return this.service.update(id, b); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
