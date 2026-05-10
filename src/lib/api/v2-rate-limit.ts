/**
 * Wave P17-B · Rate limiter in-memory para API v2.
 *
 * Ventanas deslizantes simples por API key:
 *   - 60 req / 60s   (per-minute window)
 *   - 1000 req / 3600s (per-hour window)
 *
 * Implementación: contador con timestamp del comienzo de la ventana
 * más reciente; al cruzar el umbral, se rechaza hasta que la ventana
 * "resetea" (avanza). NO es un sliding-window real (con bucket por
 * segundo) — es lo justo para MVP y simple de razonar.
 *
 * Persistencia: Map en memoria del proceso. En Vercel/serverless cada
 * instancia tiene su propio Map, así que el rate limit efectivo es
 * `60·N` por cluster — aceptable para MVP. Migración futura: Redis con
 * Upstash REST (deuda).
 *
 * Tests: el helper `__resetRateLimitState` permite reset entre suites.
 */

const PER_MINUTE_LIMIT = 60
const PER_HOUR_LIMIT = 1000
const MINUTE_WINDOW_MS = 60_000
const HOUR_WINDOW_MS = 3_600_000

interface WindowState {
  startedAt: number
  count: number
}

interface KeyState {
  minute: WindowState
  hour: WindowState
}

const store = new Map<string, KeyState>()

export interface RateLimitResult {
  allowed: boolean
  /** Cuál umbral se cruzó (si `allowed=false`). */
  scope?: 'minute' | 'hour'
  /** Cuántos ms hasta que se reseta la ventana relevante. */
  retryAfterMs: number
  /** Cuántas requests quedan en la ventana de minutos. */
  remainingMinute: number
  /** Cuántas requests quedan en la ventana de horas. */
  remainingHour: number
}

function bumpWindow(
  win: WindowState | undefined,
  now: number,
  windowMs: number,
): WindowState {
  if (!win || now - win.startedAt >= windowMs) {
    return { startedAt: now, count: 1 }
  }
  return { startedAt: win.startedAt, count: win.count + 1 }
}

/**
 * Registra una request bajo `keyId` y devuelve si está permitida. Si
 * cualquiera de las dos ventanas excede el umbral, NO incrementa más
 * allá del límite (efecto: las requests rechazadas no inflan el contador
 * — distintos rate limiters lo hacen distinto, pero aquí preferimos no
 * "double-punish").
 */
export function checkAndConsume(keyId: string, now: number = Date.now()): RateLimitResult {
  const prev = store.get(keyId)
  const minute = bumpWindow(prev?.minute, now, MINUTE_WINDOW_MS)
  const hour = bumpWindow(prev?.hour, now, HOUR_WINDOW_MS)

  const minuteOver = minute.count > PER_MINUTE_LIMIT
  const hourOver = hour.count > PER_HOUR_LIMIT

  if (minuteOver || hourOver) {
    // No persistimos el incremento extra: dejamos el counter en el
    // límite + 1 para que el próximo cómputo siga rechazando hasta que
    // expire la ventana.
    store.set(keyId, {
      minute: minuteOver ? { ...minute, count: PER_MINUTE_LIMIT + 1 } : minute,
      hour: hourOver ? { ...hour, count: PER_HOUR_LIMIT + 1 } : hour,
    })
    const scope: 'minute' | 'hour' = minuteOver ? 'minute' : 'hour'
    const retryAfterMs = scope === 'minute'
      ? Math.max(0, MINUTE_WINDOW_MS - (now - minute.startedAt))
      : Math.max(0, HOUR_WINDOW_MS - (now - hour.startedAt))
    return {
      allowed: false,
      scope,
      retryAfterMs,
      remainingMinute: Math.max(0, PER_MINUTE_LIMIT - minute.count),
      remainingHour: Math.max(0, PER_HOUR_LIMIT - hour.count),
    }
  }

  store.set(keyId, { minute, hour })
  return {
    allowed: true,
    retryAfterMs: 0,
    remainingMinute: Math.max(0, PER_MINUTE_LIMIT - minute.count),
    remainingHour: Math.max(0, PER_HOUR_LIMIT - hour.count),
  }
}

/**
 * Limpia el estado del rate limiter. Solo para tests.
 */
export function __resetRateLimitState(): void {
  store.clear()
}

export const RATE_LIMITS = {
  PER_MINUTE_LIMIT,
  PER_HOUR_LIMIT,
  MINUTE_WINDOW_MS,
  HOUR_WINDOW_MS,
} as const
