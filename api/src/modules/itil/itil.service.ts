import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class ItilService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll() {
    if (!this.supabase.isReady) return this.demoTickets();
    const { data, error } = await this.supabase.db
      .from('itil_tickets').select('*').order('opened_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async create(body: any) {
    if (!this.supabase.isReady) return { ...body, id: `demo-${Date.now()}`, code: `TCK-${Date.now()}` };
    const code = body.code ?? `TCK-${Date.now().toString(36).toUpperCase()}`;
    // apply SLA
    const { data: sla } = await this.supabase.db
      .from('sla_policies').select('*').eq('priority', body.priority ?? 'medium').single();

    const now = Date.now();
    const responseDue = sla ? new Date(now + sla.response_minutes * 60000).toISOString() : null;
    const resolutionDue = sla ? new Date(now + sla.resolution_minutes * 60000).toISOString() : null;

    const payload = {
      ...body,
      code,
      sla_response_due: responseDue,
      sla_resolution_due: resolutionDue,
      opened_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase.db.from('itil_tickets').insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, body: any) {
    if (!this.supabase.isReady) return { id, ...body };
    if (body.status === 'resolved' && !body.resolved_at) body.resolved_at = new Date().toISOString();
    const { data, error } = await this.supabase.db
      .from('itil_tickets').update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async remove(id: string) {
    if (!this.supabase.isReady) return { id, deleted: true };
    await this.supabase.db.from('itil_tickets').delete().eq('id', id);
    return { id, deleted: true };
  }

  async slaPolicies() {
    if (!this.supabase.isReady) {
      return [
        { priority: 'critical', response_minutes: 15, resolution_minutes: 240 },
        { priority: 'high', response_minutes: 60, resolution_minutes: 480 },
        { priority: 'medium', response_minutes: 240, resolution_minutes: 1440 },
        { priority: 'low', response_minutes: 480, resolution_minutes: 2880 },
      ];
    }
    const { data, error } = await this.supabase.db.from('sla_policies').select('*');
    if (error) throw error;
    return data;
  }

  private demoTickets() {
    const now = Date.now();
    return [
      { id: 't-1', code: 'TCK-001', title: 'Servidor caído', priority: 'critical', status: 'in_progress', opened_at: new Date(now - 15*60000).toISOString(), sla_response_due: new Date(now - 5*60000).toISOString(), sla_resolution_due: new Date(now + 100*60000).toISOString() },
      { id: 't-2', code: 'TCK-002', title: 'No puedo acceder VPN', priority: 'high', status: 'open', opened_at: new Date(now - 20*60000).toISOString(), sla_response_due: new Date(now + 40*60000).toISOString(), sla_resolution_due: new Date(now + 460*60000).toISOString() },
      { id: 't-3', code: 'TCK-003', title: 'Solicitud nuevo acceso', priority: 'medium', status: 'open', opened_at: new Date(now - 60*60000).toISOString(), sla_response_due: new Date(now + 180*60000).toISOString(), sla_resolution_due: new Date(now + 1380*60000).toISOString() },
    ];
  }
}
