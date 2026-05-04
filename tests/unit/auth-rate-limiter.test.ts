import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Tests del rate limiter de login (Ola P3 · Auth completo).
 *
 * Cubre:
 *   - 5 intentos OK, 6º lanza [RATE_LIMITED].
 *   - reset() limpia contador.
 *   - Window deslizante: tras WINDOW_MS, los intentos viejos se podan.
 *   - buildKey normaliza email (lowercase, trim).
 *   - cleanup() borra entries vacías.
 */

import {
  buildKey,
  recordAttempt,
  reset,
  isLimited,
  assertNotLimited,
  cleanup,
  __testing,
} from '@/lib/auth/rate-limiter'

beforeEach(() => {
  __testing.clear()
  vi.useRealTimers()
})

describe('rate-limiter', () => {
  it('1. permite 5 intentos y bloquea el 6º', () => {
    const key = buildKey('test@a.com', '1.2.3.4')
    for (let i = 0; i < 5; i++) {
      expect(() => assertNotLimited(key)).not.toThrow()
      recordAttempt(key)
    }
    expect(isLimited(key)).toBe(true)
    expect(() => assertNotLimited(key)).toThrow(/\[RATE_LIMITED\]/)
  })

  it('2. reset() limpia el contador y permite reintentos', () => {
    const key = buildKey('a@b.c', '1.1.1.1')
    for (let i = 0; i < 5; i++) recordAttempt(key)
    expect(isLimited(key)).toBe(true)
    reset(key)
    expect(isLimited(key)).toBe(false)
  })

  it('3. window deslizante: avanza el reloj y los intentos expiran', () => {
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00Z')
    vi.setSystemTime(start)

    const key = buildKey('slide@x.com', '9.9.9.9')
    for (let i = 0; i < 5; i++) recordAttempt(key)
    expect(isLimited(key)).toBe(true)

    // Avanza más allá de WINDOW_MS.
    vi.setSystemTime(new Date(start.getTime() + __testing.WINDOW_MS + 1_000))
    expect(isLimited(key)).toBe(false)
    expect(() => assertNotLimited(key)).not.toThrow()
  })

  it('4. buildKey normaliza email (case + trim) e ip vacía', () => {
    expect(buildKey(' Edwin@AVANTE.com ', '8.8.8.8')).toBe(
      'edwin@avante.com|8.8.8.8',
    )
    expect(buildKey('a@b.c', '')).toBe('a@b.c|unknown')
  })

  it('5. cleanup() elimina entries cuyos timestamps ya expiraron', () => {
    vi.useFakeTimers()
    const start = new Date('2026-02-01T00:00:00Z')
    vi.setSystemTime(start)
    const k1 = buildKey('a@x.com', '1.1.1.1')
    const k2 = buildKey('b@x.com', '2.2.2.2')
    recordAttempt(k1)
    recordAttempt(k2)
    expect(__testing.size()).toBe(2)

    vi.setSystemTime(new Date(start.getTime() + __testing.WINDOW_MS + 5_000))
    const removed = cleanup()
    expect(removed).toBe(2)
    expect(__testing.size()).toBe(0)
  })

  it('6. assertNotLimited incluye retryAfterSec en el mensaje', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00Z'))
    const key = buildKey('rl@x.com', '7.7.7.7')
    for (let i = 0; i < __testing.MAX_ATTEMPTS; i++) recordAttempt(key)
    try {
      assertNotLimited(key)
      throw new Error('debió lanzar')
    } catch (e) {
      expect((e as Error).message).toMatch(/Reintenta en \d+s/)
    }
  })
})
