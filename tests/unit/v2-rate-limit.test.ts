import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Wave P17-B · Tests del rate limiter in-memory.
 *
 * Asegura:
 *   - Permite las primeras 60 requests por minuto.
 *   - 61° request rechazada (scope=minute).
 *   - Permite 1000 por hora pero NO 60 cada minuto si suma > 1000.
 *   - Reset entre tests vía `__resetRateLimitState`.
 */

import {
  checkAndConsume,
  __resetRateLimitState,
  RATE_LIMITS,
} from '@/lib/api/v2-rate-limit'

beforeEach(() => {
  __resetRateLimitState()
})

describe('checkAndConsume - per-minute window', () => {
  it('permite las primeras 60 requests del minuto', () => {
    const now = 1_000_000
    for (let i = 0; i < RATE_LIMITS.PER_MINUTE_LIMIT; i++) {
      const r = checkAndConsume('key-A', now + i)
      expect(r.allowed).toBe(true)
    }
    expect(checkAndConsume('key-A', now + 60).allowed).toBe(false)
  })

  it('rechaza con scope=minute y retryAfterMs > 0', () => {
    const now = 5_000_000
    for (let i = 0; i < RATE_LIMITS.PER_MINUTE_LIMIT; i++) {
      checkAndConsume('key-B', now)
    }
    const r = checkAndConsume('key-B', now)
    expect(r.allowed).toBe(false)
    expect(r.scope).toBe('minute')
    expect(r.retryAfterMs).toBeGreaterThan(0)
    expect(r.retryAfterMs).toBeLessThanOrEqual(RATE_LIMITS.MINUTE_WINDOW_MS)
  })

  it('reseta tras 60s — siguiente minuto permite de nuevo', () => {
    const now = 10_000_000
    for (let i = 0; i < RATE_LIMITS.PER_MINUTE_LIMIT; i++) {
      checkAndConsume('key-C', now)
    }
    expect(checkAndConsume('key-C', now).allowed).toBe(false)
    // Avanza 1 minuto exacto
    const next = now + RATE_LIMITS.MINUTE_WINDOW_MS
    const r = checkAndConsume('key-C', next)
    expect(r.allowed).toBe(true)
  })

  it('keys distintas no se interfieren', () => {
    const now = 20_000_000
    for (let i = 0; i < RATE_LIMITS.PER_MINUTE_LIMIT; i++) {
      checkAndConsume('key-D', now)
    }
    expect(checkAndConsume('key-D', now).allowed).toBe(false)
    expect(checkAndConsume('key-E', now).allowed).toBe(true)
  })
})

describe('checkAndConsume - per-hour window', () => {
  it('rechaza con scope=hour si superas 1000 req en 1 hora', () => {
    let now = 30_000_000
    let consumed = 0
    // Avanza minuto a minuto para no chocar con per-minute window pero
    // acumular el contador horario.
    while (consumed < RATE_LIMITS.PER_HOUR_LIMIT) {
      // 60 req en este minuto
      for (let i = 0; i < RATE_LIMITS.PER_MINUTE_LIMIT; i++) {
        checkAndConsume('key-F', now)
        consumed++
      }
      now += RATE_LIMITS.MINUTE_WINDOW_MS
    }
    const r = checkAndConsume('key-F', now)
    expect(r.allowed).toBe(false)
    expect(r.scope).toBe('hour')
  })
})
