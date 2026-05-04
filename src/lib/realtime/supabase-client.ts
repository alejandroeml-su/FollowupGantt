/**
 * Cliente Supabase para Realtime (Wave P6 · Equipo A1).
 *
 * Exporta dos factories: `getBrowserClient()` (singleton lazy en runtime
 * de navegador) y `getServerClient()` (placeholder para coherencia futura
 * — Realtime no se usa desde server, pero los otros equipos pueden
 * necesitar `from()` queries con cookies en server actions).
 *
 * Importante:
 * - Si `NEXT_PUBLIC_SUPABASE_URL` o `NEXT_PUBLIC_SUPABASE_ANON_KEY` no
 *   están definidas, las factories devuelven `null` y los hooks degradan
 *   a no-op. La app no debe romper por ausencia de Realtime.
 * - El singleton evita múltiples WebSockets por pestaña (cada cliente
 *   abre su propia conexión a `wss://*.supabase.co/realtime/v1`).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let browserSingleton: SupabaseClient | null | undefined

/**
 * Lee las env vars del bundle público. En tests jsdom las inyectamos vía
 * `vi.stubEnv` y leemos `process.env` directamente.
 */
function readPublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

/**
 * Devuelve el cliente singleton del navegador. La primera llamada lo crea;
 * llamadas subsecuentes devuelven la misma instancia.
 *
 * Devuelve `null` si las env vars no están configuradas — los hooks deben
 * tratar este caso como "Realtime deshabilitado" (no-op).
 */
export function getBrowserClient(): SupabaseClient | null {
  // `undefined` significa "aún no inicializado". `null` significa
  // "inicializado pero env vars ausentes" (cacheamos para no leer process.env
  // en cada render).
  if (browserSingleton !== undefined) return browserSingleton

  const env = readPublicEnv()
  if (!env) {
    browserSingleton = null
    return null
  }

  browserSingleton = createClient(env.url, env.anonKey, {
    auth: {
      // El módulo de auth propio (Ola P1) usa cookies HTTP-only, no
      // dependemos de la auth de Supabase. Desactivamos persistencia para
      // no contaminar localStorage del cliente.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      // Mantener bajo el rate de heartbeats del WebSocket al mínimo
      // razonable para reducir consumo móvil. El SDK valida liveness con
      // un ping cada `heartbeatIntervalMs`.
      heartbeatIntervalMs: 30_000,
    },
  })

  return browserSingleton
}

/**
 * Reset del singleton. EXCLUSIVO para tests — permite forzar re-init
 * cuando un test stubea env vars distintas. NO usar en código de
 * producción.
 */
export function __resetBrowserClientForTests(): void {
  browserSingleton = undefined
}

/**
 * Placeholder de cliente server. Realtime no se usa desde server (es
 * push al navegador), pero exportamos esta factory para coherencia con
 * el patrón que pediremos a los equipos A2-A5 cuando necesiten queries
 * desde server actions con auth de Supabase.
 *
 * Hoy devuelve `null` por defecto: el módulo de auth propio (cookies
 * HTTP-only via `iron-session` en Ola P1) cubre todas las queries server.
 */
export function getServerClient(): SupabaseClient | null {
  return null
}
