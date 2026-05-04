/**
 * Ola P5 · Equipo P5-5 — Rate limit anti-spam para submissions públicas.
 *
 * Implementación simple por IP basada en consultas a `FormSubmission` con
 * ventana móvil de 1 hora. La función exportada `checkRateLimit` recibe un
 * delegado de conteo (`countSubmissionsSince`) para mantener el módulo
 * libre de Prisma — esto facilita testing unitario y permite reusarlo en
 * cron / edge sin acoplarse al pool serverless.
 *
 * D-FA-RL-1: Por simplicidad usamos contador por (ip, hora). En P6 se
 *           podría migrar a Redis sliding window si la BD se vuelve
 *           cuello de botella.
 */

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1h
export const RATE_LIMIT_MAX_PER_WINDOW = 5

export type CountSubmissionsSince = (
  ip: string,
  sinceMs: number,
) => Promise<number>

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSec: number
}

/**
 * Verifica si la IP puede enviar una submission más. Devuelve `ok=false`
 * cuando alcanzó el límite. `retryAfterSec` es una estimación basada en
 * la ventana fija (no el momento exacto del primer hit).
 */
export async function checkRateLimit(
  ip: string | null,
  countSince: CountSubmissionsSince,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  // IP desconocida ⇒ no podemos limitar; aceptamos pero sin marca de IP.
  // El honeypot + validación schema cubren el resto del riesgo.
  if (!ip) {
    return { ok: true, remaining: RATE_LIMIT_MAX_PER_WINDOW, retryAfterSec: 0 }
  }
  const sinceMs = now.getTime() - RATE_LIMIT_WINDOW_MS
  const count = await countSince(ip, sinceMs)
  const remaining = Math.max(0, RATE_LIMIT_MAX_PER_WINDOW - count)
  if (count >= RATE_LIMIT_MAX_PER_WINDOW) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    }
  }
  return { ok: true, remaining, retryAfterSec: 0 }
}

/**
 * Honeypot: nombre de campo invisible. Si llega con valor, asumimos bot.
 * Mantenemos el nombre suficientemente común (muchos spambots autocompletan
 * cualquier `<input name="...">` que vean) pero ajeno a campos reales.
 */
export const HONEYPOT_FIELD_NAME = 'website_url'

export function isHoneypotTriggered(payload: Record<string, unknown>): boolean {
  const v = payload[HONEYPOT_FIELD_NAME]
  if (v === undefined || v === null) return false
  if (typeof v === 'string' && v.trim() === '') return false
  return true
}
