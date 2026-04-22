import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll() {
    if (!this.supabase.isReady) {
      return [
        { id: 'u1', email: 'admin@company.com', full_name: 'System Admin', role: 'admin' },
        { id: 'u2', email: 'pm@company.com', full_name: 'Jane PM', role: 'pm' },
        { id: 'u3', email: 'dev@company.com', full_name: 'John Dev', role: 'dev' },
      ];
    }
    const { data, error } = await this.supabase.db.from('users').select('*').order('full_name');
    if (error) throw error;
    return data;
  }

  async create(body: any) {
    if (!this.supabase.isReady) return { ...body, id: `demo-${Date.now()}` };
    const { data, error } = await this.supabase.db.from('users').insert(body).select().single();
    if (error) throw error;
    return data;
  }
}
