import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll() {
    if (!this.supabase.isReady) return this.demoProjects();
    const { data, error } = await this.supabase.db
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findOne(id: string) {
    if (!this.supabase.isReady) {
      const demo = this.demoProjects().find((p) => p.id === id);
      if (!demo) throw new NotFoundException();
      return demo;
    }
    const { data, error } = await this.supabase.db
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException(error.message);
    return data;
  }

  async create(payload: any) {
    if (!this.supabase.isReady) return { ...payload, id: `demo-${Date.now()}` };
    const { data, error } = await this.supabase.db
      .from('projects')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, payload: any) {
    if (!this.supabase.isReady) return { id, ...payload };
    const { data, error } = await this.supabase.db
      .from('projects')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    const { error } = await this.supabase.db.from('projects').delete().eq('id', id);
    if (error) throw error;
    return { id, deleted: true };
  }

  private demoProjects() {
    return [
      {
        id: 'demo-1',
        code: 'P-001',
        name: 'Plataforma Demo',
        description: 'Proyecto demo híbrido (sin conexión a Supabase)',
        methodology: 'hybrid',
        status: 'active',
        start_date: '2026-04-01',
        end_date: '2026-07-01',
        budget: 150000,
        actual_cost: 45000,
      },
    ];
  }
}
