import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class TasksService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(projectId?: string) {
    if (!this.supabase.isReady) return this.demoTasks(projectId);
    let q = this.supabase.db.from('tasks').select('*').order('position', { ascending: true });
    if (projectId) q = q.eq('project_id', projectId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async findOne(id: string) {
    if (!this.supabase.isReady) {
      const demo = this.demoTasks().find((t) => t.id === id);
      if (!demo) throw new NotFoundException();
      return demo;
    }
    const { data, error } = await this.supabase.db
      .from('tasks').select('*').eq('id', id).single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async create(payload: any) {
    if (!this.supabase.isReady) return { ...payload, id: `demo-${Date.now()}` };
    const { data, error } = await this.supabase.db
      .from('tasks').insert(payload).select().single();
    if (error) throw error;
    await this.logEvent(payload.project_id, 'task', data.id, 'created', payload);
    return data;
  }

  async update(id: string, payload: any) {
    if (!this.supabase.isReady) return { id, ...payload };
    const { data, error } = await this.supabase.db
      .from('tasks')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    await this.logEvent(data.project_id, 'task', id, 'updated', payload);

    // If marked done, set progress 100 (Sync híbrida: UAT-03)
    if (payload.status === 'done' || payload.progress === 100) {
      await this.supabase.db.from('tasks').update({ progress: 100 }).eq('id', id);
    }
    return data;
  }

  async remove(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    const { error } = await this.supabase.db.from('tasks').delete().eq('id', id);
    if (error) throw error;
    return { id, deleted: true };
  }

  async moveToColumn(id: string, columnId: string, position: number) {
    if (!this.supabase.isReady) return { id, column_id: columnId, position };
    // check WIP
    const { data: col } = await this.supabase.db
      .from('kanban_columns').select('*').eq('id', columnId).single();
    if (col && col.wip_limit > 0) {
      const { count } = await this.supabase.db
        .from('tasks').select('*', { count: 'exact', head: true })
        .eq('column_id', columnId);
      if ((count ?? 0) >= col.wip_limit) {
        await this.logEvent(col.project_id, 'kanban', columnId, 'wip_overflow', {
          column: col.name, limit: col.wip_limit, current: count,
        });
      }
    }
    return this.update(id, { column_id: columnId, position });
  }

  private async logEvent(projectId: any, entityType: string, entityId: string, eventType: string, payload: any) {
    if (!this.supabase.isReady || !projectId) return;
    try {
      await this.supabase.db.from('events').insert({
        project_id: projectId, entity_type: entityType, entity_id: entityId,
        event_type: eventType, payload,
      });
    } catch {}
  }

  private demoTasks(projectId?: string) {
    const base = [
      { id: 'd-t1', project_id: 'demo-1', title: 'Setup repo', type: 'task', status: 'done', progress: 100, priority: 'high', start_date: '2026-04-01', due_date: '2026-04-03', story_points: 3, position: 0 },
      { id: 'd-t2', project_id: 'demo-1', title: 'Diseño arquitectura', type: 'story', status: 'in_progress', progress: 60, priority: 'high', start_date: '2026-04-04', due_date: '2026-04-10', story_points: 5, position: 1, is_critical_path: true },
      { id: 'd-t3', project_id: 'demo-1', title: 'Implementar API', type: 'task', status: 'todo', progress: 0, priority: 'medium', start_date: '2026-04-11', due_date: '2026-04-25', story_points: 8, position: 2, is_critical_path: true },
      { id: 'd-t4', project_id: 'demo-1', title: 'Hito: MVP listo', type: 'milestone', status: 'todo', progress: 0, priority: 'critical', start_date: '2026-05-01', due_date: '2026-05-01', is_milestone: true, position: 3 },
    ];
    return projectId ? base.filter((t) => t.project_id === projectId) : base;
  }
}
