/**
 * Cliente Supabase compartido para Realtime (Wave P6 hooks + posteriores).
 *
 * Re-exporta el SINGLETON de `@/lib/realtime/supabase-client` (`getBrowserClient`)
 * en lugar de crear su propio `createClient`. Razón: cuando dos módulos llaman
 * `createClient(...)` independientemente, ambos instancian sus propios
 * `GoTrueClient` y `RealtimeClient`. El navegador entonces abre 2 websockets
 * contra `wss://*.supabase.co/realtime/v1/websocket`; el segundo cierra al
 * primero y los `channel.subscribe()` en vuelo quedan en estado inconsistente,
 * provocando el crash `cannot add 'presence' callbacks for realtime:<topic>
 * after 'subscribe()'` que rompía `/gantt` al abrir el drawer de tarea
 * (Wave P6 · B1 presence + B3 edit-lock + A3 comments todos usando este
 * import).
 *
 * Si las env vars de Supabase no están configuradas el singleton es `null`;
 * para preservar el contrato histórico de este módulo (`supabase` siempre
 * tipo `SupabaseClient`), creamos un cliente stub idempotente con valores
 * vacíos — los hooks ya degradan a no-op cuando los `channel()` fallan.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBrowserClient } from '@/lib/realtime/supabase-client';

function getOrCreate(): SupabaseClient {
  const shared = getBrowserClient();
  if (shared) return shared;
  // Stub para SSR / env vars ausentes — no se conectará, pero el tipo se mantiene.
  return createClient('http://localhost', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const supabase: SupabaseClient = getOrCreate();
