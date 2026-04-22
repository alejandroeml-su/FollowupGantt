import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class KpisService {
  constructor(private readonly supabase: SupabaseService) {}

  async summary(projectId?: string) {
    // Demo / unconnected mode
    if (!this.supabase.isReady) {
      return this.demoSummary();
    }

    const projectFilter = (q: any) => (projectId ? q.eq('project_id', projectId) : q);

    // Flow metrics
    const { data: tasks } = await projectFilter(this.supabase.db.from('tasks').select('*'));
    const done = (tasks ?? []).filter((t: any) => t.status === 'done');
    const throughput = done.length;

    let cycle = 0;
    if (done.length) {
      const totalMs = done.reduce((acc: number, t: any) => {
        if (t.actual_start && t.actual_end) {
          return acc + (new Date(t.actual_end).getTime() - new Date(t.actual_start).getTime());
        }
        return acc;
      }, 0);
      cycle = totalMs / done.length / 86400000;
    }

    // ITIL
    const { data: tickets } = await this.supabase.db.from('itil_tickets').select('*');
    const slaMet = (tickets ?? []).filter((t: any) => !t.sla_breached).length;
    const slaRate = tickets && tickets.length ? (slaMet / tickets.length) * 100 : 100;

    let mttr = 0;
    const resolved = (tickets ?? []).filter((t: any) => t.resolved_at && t.opened_at);
    if (resolved.length) {
      const ms = resolved.reduce((acc: number, t: any) => acc + (new Date(t.resolved_at).getTime() - new Date(t.opened_at).getTime()), 0);
      mttr = ms / resolved.length / 3600000; // hours
    }

    // Governance (demo calc)
    const spi = 0.95;
    const cpi = 1.02;
    const utilization = 78;

    return {
      flow: { cycle_time_days: +cycle.toFixed(2), throughput, wip: (tasks ?? []).filter((t: any) => t.status === 'in_progress').length },
      governance: { spi, cpi, utilization_percent: utilization },
      service: { sla_compliance_rate: +slaRate.toFixed(1), mttr_hours: +mttr.toFixed(2), open_tickets: (tickets ?? []).filter((t: any) => t.status !== 'closed' && t.status !== 'resolved').length },
      cfd: this.buildCfdDemo(tasks ?? []),
    };
  }

  private buildCfdDemo(tasks: any[]) {
    const today = new Date();
    const series: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      series.push({
        date: d.toISOString().slice(0, 10),
        todo: Math.max(0, tasks.filter((t: any) => t.status === 'todo').length - i),
        in_progress: Math.max(0, tasks.filter((t: any) => t.status === 'in_progress').length),
        done: Math.max(0, tasks.filter((t: any) => t.status === 'done').length - (6 - i)),
      });
    }
    return series;
  }

  private demoSummary() {
    return {
      flow: { cycle_time_days: 3.2, throughput: 12, wip: 4 },
      governance: { spi: 0.98, cpi: 1.04, utilization_percent: 82 },
      service: { sla_compliance_rate: 94.5, mttr_hours: 3.8, open_tickets: 3 },
      cfd: [
        { date: '2026-04-16', todo: 8, in_progress: 3, done: 1 },
        { date: '2026-04-17', todo: 7, in_progress: 4, done: 3 },
        { date: '2026-04-18', todo: 6, in_progress: 4, done: 5 },
        { date: '2026-04-19', todo: 5, in_progress: 5, done: 7 },
        { date: '2026-04-20', todo: 5, in_progress: 4, done: 9 },
        { date: '2026-04-21', todo: 4, in_progress: 4, done: 11 },
        { date: '2026-04-22', todo: 3, in_progress: 4, done: 12 },
      ],
    };
  }
}
