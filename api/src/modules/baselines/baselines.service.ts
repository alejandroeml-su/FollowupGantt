import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class BaselinesService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll(projectId: string) {
    if (!this.supabase.isReady) return [];
    const { data, error } = await this.supabase.db
      .from('baselines').select('*').eq('project_id', projectId).order('version', { ascending: false });
    if (error) throw error;
    return data;
  }

  async create(projectId: string, name: string, notes: string, userId?: string) {
    if (!this.supabase.isReady) return { id: `demo-${Date.now()}`, name, version: 1 };
    // enforce max 3
    const { data: existing } = await this.supabase.db
      .from('baselines').select('id,version').eq('project_id', projectId).order('version', { ascending: false });
    if ((existing?.length ?? 0) >= 3) {
      throw new BadRequestException('Maximum 3 baselines reached. Delete one first.');
    }
    const version = (existing?.[0]?.version ?? 0) + 1;

    const { data: tasks } = await this.supabase.db.from('tasks').select('*').eq('project_id', projectId);
    const { data: project } = await this.supabase.db.from('projects').select('*').eq('id', projectId).single();

    const snapshot = {
      project,
      tasks,
      snapshot_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase.db.from('baselines').insert({
      project_id: projectId, name, version, snapshot, notes, created_by: userId ?? null,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async remove(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    await this.supabase.db.from('baselines').delete().eq('id', id);
    return { id, deleted: true };
  }

  // Schedule Variance report
  async variance(baselineId: string) {
    if (!this.supabase.isReady) {
      return { sv: 2, sv_percent: 5.3, tasks_on_track: 4, tasks_delayed: 1 };
    }
    const { data: bl } = await this.supabase.db.from('baselines').select('*').eq('id', baselineId).single();
    if (!bl) throw new BadRequestException('Baseline not found');
    const baseTasks = bl.snapshot?.tasks ?? [];
    const { data: currentTasks } = await this.supabase.db.from('tasks').select('*').eq('project_id', bl.project_id);

    let delayed = 0;
    let onTrack = 0;
    let totalShift = 0;
    (currentTasks ?? []).forEach((c: any) => {
      const b = baseTasks.find((t: any) => t.id === c.id);
      if (!b) return;
      if (b.due_date && c.due_date) {
        const diff = (new Date(c.due_date).getTime() - new Date(b.due_date).getTime()) / 86400000;
        totalShift += diff;
        if (diff > 0) delayed++; else onTrack++;
      }
    });

    return { sv_days: totalShift, tasks_on_track: onTrack, tasks_delayed: delayed, baseline: bl };
  }
}
