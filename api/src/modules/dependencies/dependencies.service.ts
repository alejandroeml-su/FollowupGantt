import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class DependenciesService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(projectId?: string) {
    if (!this.supabase.isReady) return [];
    const q = this.supabase.db.from('task_dependencies').select('*, predecessor:predecessor_id(*), successor:successor_id(*)');
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).filter((d: any) => !projectId || d.predecessor?.project_id === projectId);
  }

  async create(b: any) {
    if (!this.supabase.isReady) return { ...b, id: `demo-${Date.now()}` };
    const { data, error } = await this.supabase.db.from('task_dependencies').insert(b).select().single();
    if (error) throw error;
    return data;
  }

  async remove(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    await this.supabase.db.from('task_dependencies').delete().eq('id', id);
    return { id, deleted: true };
  }
}
