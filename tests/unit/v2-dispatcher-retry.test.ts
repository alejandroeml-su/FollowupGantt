import { describe, it, expect } from 'vitest'

/**
 * Wave P17-B · Tests puros de la lógica de retry/backoff del dispatcher.
 *
 * NO testeamos el side-effect Prisma aquí (eso es integración) — sólo la
 * función pura `computeBackoffMs` que define el schedule 1s · 5s · 30s y
 * la constante `MAX_RETRIES`.
 */

import {
  computeBackoffMs,
  MAX_RETRIES,
  FAILURE_DISABLE_THRESHOLD,
} from '@/lib/webhooks-out/dispatcher'

describe('computeBackoffMs', () => {
  it('retryCount 0 ⇒ 0 (primer intento, sin espera)', () => {
    expect(computeBackoffMs(0)).toBe(0)
  })

  it('retryCount 1 ⇒ 1000ms', () => {
    expect(computeBackoffMs(1)).toBe(1_000)
  })

  it('retryCount 2 ⇒ 5000ms', () => {
    expect(computeBackoffMs(2)).toBe(5_000)
  })

  it('retryCount 3 ⇒ 30000ms', () => {
    expect(computeBackoffMs(3)).toBe(30_000)
  })

  it('retryCount > 3 fallback al último valor (defensivo)', () => {
    expect(computeBackoffMs(99)).toBe(30_000)
  })

  it('retryCount negativo ⇒ 0 (defensivo)', () => {
    expect(computeBackoffMs(-1)).toBe(0)
  })
})

describe('constantes del dispatcher', () => {
  it('MAX_RETRIES = 3 (total de envíos = 4)', () => {
    expect(MAX_RETRIES).toBe(3)
  })

  it('FAILURE_DISABLE_THRESHOLD = 10', () => {
    expect(FAILURE_DISABLE_THRESHOLD).toBe(10)
  })
})
