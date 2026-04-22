import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class KanbanService {
  constructor(private readonly supabase: SupabaseService) {}

  async board(projectId: string) {
    if (!this.supabase.isReady) return this.demo();
    const { data: columns, error } = await this.supabase.db
      .from('kanban_columns').select('*').eq('project_id', projectId).order('position');
    if (error) throw error;

    const { data: tasks } = await this.supabase.db
      .from('tasks').select('*').eq('project_id', projectId).order('position');

    return (columns ?? []).map((c) => {
      const items = (tasks ?? []).filter((t: any) => t.column_id === c.id);
      return {
        ...c,
        items,
        wip_exceeded: c.wip_limit > 0 && items.length > c.wip_limit,
      };
    });
  }

  async createColumn(body: any) {
    if (!this.supabase.isReady) return { ...body, id: `demo-${Date.now()}` };
    const { data, error } = await this.supabase.db.from('kanban_columns').insert(body).select().single();
    if (error) throw error;
    return data;
  }

  async updateColumn(id: string, body: any) {
    if (!this.supabase.isReady) return { id, ...body };
    const { data, error } = await this.supabase.db.from('kanban_columns').update(body).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async removeColumn(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    await this.supabase.db.from('kanban_columns').delete().eq('id', id);
    return { id, deleted: true };
  }

  private demo() {
    return [
      { id: 'c1', name: 'Backlog', position: 0, wip_limit: 0, color: '#6B7280', items: [
        { id: 'd-t5', title: 'Refactor auth', type: 'task', priority: 'medium', story_points: 3 },
      ]},
      { id: 'c2', name: 'To Do', position: 1, wip_limit: 5, color: '#3B82F6', items: [
        { id: 'd-t1', title: 'Setup repo', type: 'task', priority: 'high', story_points: 3 },
      ]},
      { id: 'c3', name: 'In Progress', position: 2, wip_limit: 3, color: '#F59E0B', wip_exceeded: false, items: [
        { id: 'd-t2', title: 'Diseño arquitectura', type: 'story', priority: 'high', story_points: 5 },
      ]},
      { id: 'c4', name: 'Review', position: 3, wip_limit: 2, color: '#8B5CF6', items: [] },
      { id: 'c5', name: 'Done', position: 4, wip_limit: 0, color: '#10B981', is_done_column: true, items: [] },
    ];
  }
}
