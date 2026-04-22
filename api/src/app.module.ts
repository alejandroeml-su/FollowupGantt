import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from './supabase/supabase.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SprintsModule } from './modules/sprints/sprints.module';
import { KanbanModule } from './modules/kanban/kanban.module';
import { GanttModule } from './modules/gantt/gantt.module';
import { DependenciesModule } from './modules/dependencies/dependencies.module';
import { BaselinesModule } from './modules/baselines/baselines.module';
import { ItilModule } from './modules/itil/itil.module';
import { KpisModule } from './modules/kpis/kpis.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    ProjectsModule,
    TasksModule,
    SprintsModule,
    KanbanModule,
    GanttModule,
    DependenciesModule,
    BaselinesModule,
    ItilModule,
    KpisModule,
    UsersModule,
  ],
})
export class AppModule {}
