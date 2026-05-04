import { describe, it, expect, vi } from 'vitest'
import {
  checkRateLimit,
  isHoneypotTriggered,
  HONEYPOT_FIELD_NAME,
  RATE_LIMIT_MAX_PER_WINDOW,
} from '@/lib/forms/rate-limit'
import { isValidSlug, slugify } from '@/lib/forms/slug'

/**
 * Ola P5 · Equipo P5-5 — Tests de anti-spam (honeypot + rate limit) y slug.
 */

describe('checkRateLimit', () => {
  it('permite cuando count < max', async () => {
    const r = await checkRateLimit('1.2.3.4', async () => 0)
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(RATE_LIMIT_MAX_PER_WINDOW)
  })

  it('bloquea cuando se alcanzó el límite', async () => {
    const r = await checkRateLimit('1.2.3.4', async () => RATE_LIMIT_MAX_PER_WINDOW)
    expect(r.ok).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
  })

  it('permite si la IP es null (no podemos limitar)', async () => {
    const counter = vi.fn(async () => 99)
    const r = await checkRateLimit(null, counter)
    expect(r.ok).toBe(true)
    expect(counter).not.toHaveBeenCalled()
  })

  it('decrementa remaining según count', async () => {
    const r = await checkRateLimit('1.1.1.1', async () => 2)
    expect(r.remaining).toBe(RATE_LIMIT_MAX_PER_WINDOW - 2)
  })
})

describe('isHoneypotTriggered', () => {
  it('false si el campo no viene', () => {
    expect(isHoneypotTriggered({ nombre: 'X' })).toBe(false)
  })

  it('false si el campo viene vacío', () => {
    expect(isHoneypotTriggered({ [HONEYPOT_FIELD_NAME]: '' })).toBe(false)
  })

  it('true si el campo viene con valor', () => {
    expect(isHoneypotTriggered({ [HONEYPOT_FIELD_NAME]: 'http://spam.example' })).toBe(true)
  })
})

describe('slug helpers', () => {
  it('isValidSlug acepta kebab-case', () => {
    expect(isValidSlug('soporte-itil')).toBe(true)
    expect(isValidSlug('a')).toBe(true)
  })

  it('isValidSlug rechaza mayúsculas / espacios', () => {
    expect(isValidSlug('Soporte')).toBe(false)
    expect(isValidSlug('con espacios')).toBe(false)
    expect(isValidSlug('-leading')).toBe(false)
  })

  it('slugify normaliza títulos arbitrarios', () => {
    expect(slugify('Solicitud de Soporte ITIL')).toBe('solicitud-de-soporte-itil')
    expect(slugify('  Múltiples   espacios!! ')).toBe('multiples-espacios')
  })
})
