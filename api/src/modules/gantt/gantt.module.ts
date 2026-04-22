import { Module } from '@nestjs/common';
import { GanttController } from './gantt.controller';
import { GanttService } from './gantt.service';

@Module({ controllers: [GanttController], providers: [GanttService] })
export class GanttModule {}
