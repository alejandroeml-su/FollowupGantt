import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class GanttService {
  constructor(private readonly supabase: SupabaseService) {}

  async timeline(projectId: string) {
    let tasks: any[] = [];
    let deps: any[] = [];

    if (!this.supabase.isReady) {
      tasks = this.demoTasks();
      deps = this.demoDeps();
    } else {
      const { data: t } = await this.supabase.db
        .from('tasks').select('*').eq('project_id', projectId).order('start_date');
      tasks = t ?? [];
      const ids = tasks.map((x) => x.id);
      if (ids.length) {
        const { data: d } = await this.supabase.db
          .from('task_dependencies').select('*')
          .in('predecessor_id', ids);
        deps = d ?? [];
      }
    }

    const result = this.calculateCriticalPath(tasks, deps);
    return { tasks: result.tasks, dependencies: deps, critical_path: result.critical };
  }

  // Basic CPM-lite: calculates forward pass and marks longest chain as critical
  private calculateCriticalPath(tasks: any[], deps: any[]) {
    const byId: Record<string, any> = {};
    tasks.forEach((t) => (byId[t.id] = { ...t, es: 0, ef: 0, ls: 0, lf: 0 }));

    const durationDays = (t: any) => {
      if (!t.start_date || !t.due_date) return 1;
      const s = new Date(t.start_date).getTime();
      const e = new Date(t.due_date).getTime();
      return Math.max(1, Math.round((e - s) / 86400000) + 1);
    };

    // forward pass
    tasks.forEach((t) => {
      const d = durationDays(t);
      const preds = deps.filter((x) => x.successor_id === t.id);
      let es = 0;
      preds.forEach((p) => {
        const pred = byId[p.predecessor_id];
        if (pred) es = Math.max(es, pred.ef + (p.lag_days || 0));
      });
      byId[t.id].es = es;
      byId[t.id].ef = es + d;
    });

    // project end
    const projectEnd = Math.max(...Object.values(byId).map((x: any) => x.ef), 0);

    // backward pass
    [...tasks].reverse().forEach((t) => {
      const d = durationDays(t);
      const succs = deps.filter((x) => x.predecessor_id === t.id);
      let lf = projectEnd;
      succs.forEach((s) => {
        const succ = byId[s.successor_id];
        if (succ) lf = Math.min(lf, succ.ls - (s.lag_days || 0));
      });
      byId[t.id].lf = lf;
      byId[t.id].ls = lf - d;
      byId[t.id].slack_days = byId[t.id].ls - byId[t.id].es;
      byId[t.id].is_critical_path = byId[t.id].slack_days <= 0;
    });

    const critical = Object.values(byId).filter((x: any) => x.is_critical_path).map((x: any) => x.id);
    return { tasks: Object.values(byId), critical };
  }

  private demoTasks() {
    return [
      { id: 't1', title: 'Análisis', type: 'task', start_date: '2026-04-01', due_date: '2026-04-05', progress: 100 },
      { id: 't2', title: 'Diseño', type: 'task', start_date: '2026-04-06', due_date: '2026-04-15', progress: 60 },
      { id: 't3', title: 'Desarrollo', type: 'task', start_date: '2026-04-16', due_date: '2026-05-10', progress: 20 },
      { id: 't4', title: 'Pruebas', type: 'task', start_date: '2026-05-11', due_date: '2026-05-20', progress: 0 },
      { id: 't5', title: 'Hito: Go Live', type: 'milestone', start_date: '2026-05-21', due_date: '2026-05-21', is_milestone: true, progress: 0 },
    ];
  }
  private demoDeps() {
    return [
      { id: 'd1', predecessor_id: 't1', successor_id: 't2', dep_type: 'FS', lag_days: 0 },
      { id: 'd2', predecessor_id: 't2', successor_id: 't3', dep_type: 'FS', lag_days: 0 },
      { id: 'd3', predecessor_id: 't3', successor_id: 't4', dep_type: 'FS', lag_days: 0 },
      { id: 'd4', predecessor_id: 't4', successor_id: 't5', dep_type: 'FS', lag_days: 0 },
    ];
  }
}
