import { describe, it, expect } from 'vitest'

/**
 * Ola P4 · Equipo P4-2 — tests de firma HMAC SHA-256 de webhooks.
 *
 * Cubre `signPayload`, `verifySignature` (timing-safe), formato de header
 * `sha256=<hex>` y casos negativos (secret vacío, header malformado).
 */

import {
  signPayload,
  verifySignature,
  generateWebhookSecret,
  SIGNATURE_HEADER,
  SIGNATURE_PREFIX,
} from '@/lib/webhooks/signature'

describe('signPayload', () => {
  it('produce header con prefijo sha256= seguido de hex', () => {
    const sig = signPayload('shhh', '{"event":"test"}')
    expect(sig.startsWith(SIGNATURE_PREFIX)).toBe(true)
    expect(sig.slice(SIGNATURE_PREFIX.length)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mismo (secret, body) produce misma firma; cambios cambian la firma', () => {
    const a = signPayload('s1', 'body')
    const b = signPayload('s1', 'body')
    const c = signPayload('s1', 'body!')
    const d = signPayload('s2', 'body')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(d)
  })

  it('lanza con secret vacío', () => {
    expect(() => signPayload('', 'body')).toThrow(/INVALID_SECRET/)
  })
})

describe('verifySignature', () => {
  it('acepta firma generada por signPayload', () => {
    const body = JSON.stringify({ event: 'task.created', id: 'x' })
    const sig = signPayload('topsecret', body)
    expect(verifySignature('topsecret', body, sig)).toBe(true)
  })

  it('rechaza firma con secret distinto', () => {
    const body = 'payload'
    const sig = signPayload('s1', body)
    expect(verifySignature('s2', body, sig)).toBe(false)
  })

  it('rechaza firma cuando body cambia', () => {
    const sig = signPayload('s1', 'original')
    expect(verifySignature('s1', 'tampered', sig)).toBe(false)
  })

  it('rechaza header sin prefijo sha256=', () => {
    const body = 'b'
    const sig = signPayload('s1', body).slice(SIGNATURE_PREFIX.length)
    expect(verifySignature('s1', body, sig)).toBe(false)
  })

  it('rechaza null/undefined/string vacío', () => {
    expect(verifySignature('s1', 'b', null)).toBe(false)
    expect(verifySignature('s1', 'b', undefined)).toBe(false)
    expect(verifySignature('s1', 'b', '')).toBe(false)
  })

  it('rechaza si secret está vacío', () => {
    const sig = signPayload('s1', 'b')
    expect(verifySignature('', 'b', sig)).toBe(false)
  })
})

describe('generateWebhookSecret', () => {
  it('genera 64 chars hex (32 bytes)', () => {
    const s = generateWebhookSecret()
    expect(s).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cada llamada produce secrets distintos', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret())
  })
})

describe('SIGNATURE_HEADER', () => {
  it('usa la convención exacta del repo', () => {
    expect(SIGNATURE_HEADER).toBe('X-FollowupGantt-Signature')
  })
})
