import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { KanbanService } from './kanban.service';

@Controller('kanban')
export class KanbanController {
  constructor(private readonly service: KanbanService) {}

  @Get('board') board(@Query('project_id') p: string) { return this.service.board(p); }
  @Post('columns') createColumn(@Body() b: any) { return this.service.createColumn(b); }
  @Patch('columns/:id') updateColumn(@Param('id') id: string, @Body() b: any) { return this.service.updateColumn(id, b); }
  @Delete('columns/:id') removeColumn(@Param('id') id: string) { return this.service.removeColumn(id); }
}
