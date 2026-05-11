import 'server-only'

/**
 * Support Chatbot · rate limiter por usuario (in-memory).
 *
 * Política: 30 requests por hora por userId. Sliding window simple usando
 * `Map<userId, timestamps[]>` con pruning lazy. Errores tipados:
 *   `[RATE_LIMITED]` con detalle del retry-after.
 *
 * Compartimos el patrón del login rate limiter (`src/lib/auth/rate-limiter.ts`)
 * pero con ventana y umbral distintos. No hacemos shared store porque en
 * Vercel serverless el aislamiento entre instancias YA limita el daño
 * (un atacante coordinado pagaría por sí solo el costo del LLM).
 *
 * El Map es module-scoped → persiste entre requests dentro del mismo
 * proceso. Migración a Redis pendiente si el chatbot crece (ticket-fut).
 */

const WINDOW_MS = 60 * 60 * 1000
const MAX_REQUESTS = 30

const hits: Map<string, number[]> = new Map()

function prune(stamps: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS
  const idx = stamps.findIndex((t) => t > cutoff)
  return idx < 0 ? [] : stamps.slice(idx)
}

/**
 * Lanza `[RATE_LIMITED]` si el usuario excedió el cupo. Registra el hit
 * en caso contrario.
 */
export function assertWithinSupportLimit(userId: string): void {
  if (!userId) {
    throw new Error('[INVALID_INPUT] userId es requerido para rate-limit')
  }
  const now = Date.now()
  const current = prune(hits.get(userId) ?? [], now)
  if (current.length >= MAX_REQUESTS) {
    const oldest = current[0]
    const retryInSec = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000),
    )
    throw new Error(
      `[RATE_LIMITED] Límite de ${MAX_REQUESTS} mensajes/hora alcanzado. Reintenta en ${retryInSec}s.`,
    )
  }
  current.push(now)
  hits.set(userId, current)
}

/**
 * Test helper — reset todos los contadores. NO usar en código de producción.
 */
export function __resetSupportRateLimitForTests(): void {
  hits.clear()
}

export const SUPPORT_RATE_LIMIT = {
  windowMs: WINDOW_MS,
  maxRequests: MAX_REQUESTS,
} as const
