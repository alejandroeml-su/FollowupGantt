import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;
  private adminClient: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('SUPABASE_URL');
    const anon = this.config.get<string>('SUPABASE_ANON_KEY');
    const service = this.config.get<string>('SUPABASE_SERVICE_KEY');

    if (!url || !anon) {
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_ANON_KEY not set. Running in demo mode (no persistence).',
      );
      return;
    }

    this.client = createClient(url, anon, {
      auth: { persistSession: false },
    });

    if (service) {
      this.adminClient = createClient(url, service, {
        auth: { persistSession: false },
      });
    }

    this.logger.log('Supabase clients initialized');
  }

  get db(): SupabaseClient {
    return this.adminClient ?? this.client;
  }

  get isReady(): boolean {
    return !!this.client;
  }
}
