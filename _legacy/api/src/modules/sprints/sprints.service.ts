import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class SprintsService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(projectId?: string) {
    if (!this.supabase.isReady) return [];
    let q = this.supabase.db.from('sprints').select('*').order('start_date', { ascending: true });
    if (projectId) q = q.eq('project_id', projectId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async create(body: any) {
    if (!this.supabase.isReady) return { ...body, id: `demo-${Date.now()}` };
    const { data, error } = await this.supabase.db.from('sprints').insert(body).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, body: any) {
    if (!this.supabase.isReady) return { id, ...body };
    const { data, error } = await this.supabase.db.from('sprints').update(body).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async remove(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    await this.supabase.db.from('sprints').delete().eq('id', id);
    return { id, deleted: true };
  }
}
