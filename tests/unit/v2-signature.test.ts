import { describe, it, expect } from 'vitest'

/**
 * Wave P17-B · Tests de la firma HMAC SHA-256 v2.
 */

import {
  signPayload,
  verifySignature,
  generateWebhookSecret,
  V2_SIGNATURE_HEADER,
  V2_SIGNATURE_PREFIX,
} from '@/lib/webhooks-out/signature'

describe('signPayload', () => {
  it('produce header con prefijo sha256= y hex de 64 chars', () => {
    const sig = signPayload('topsecret', '{"event":"task.created"}')
    expect(sig.startsWith(V2_SIGNATURE_PREFIX)).toBe(true)
    const hex = sig.slice(V2_SIGNATURE_PREFIX.length)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mismo body+secret produce misma firma (determinista)', () => {
    const a = signPayload('s1', 'payload')
    const b = signPayload('s1', 'payload')
    expect(a).toBe(b)
  })

  it('secret distinto produce firma distinta', () => {
    const a = signPayload('s1', 'payload')
    const b = signPayload('s2', 'payload')
    expect(a).not.toBe(b)
  })

  it('lanza si secret es vacío', () => {
    expect(() => signPayload('', 'body')).toThrow(/INVALID_SECRET/)
  })

  it('header constante es X-Signature-256', () => {
    expect(V2_SIGNATURE_HEADER).toBe('X-Signature-256')
  })
})

describe('verifySignature', () => {
  const secret = 'mySecretKey123'
  const body = '{"foo":"bar"}'

  it('acepta una firma válida', () => {
    const sig = signPayload(secret, body)
    expect(verifySignature(secret, body, sig)).toBe(true)
  })

  it('rechaza si el body cambia', () => {
    const sig = signPayload(secret, body)
    expect(verifySignature(secret, '{"foo":"baz"}', sig)).toBe(false)
  })

  it('rechaza si el secret cambia', () => {
    const sig = signPayload(secret, body)
    expect(verifySignature('otroSecret', body, sig)).toBe(false)
  })

  it('rechaza header sin prefijo sha256=', () => {
    expect(verifySignature(secret, body, 'invalid')).toBe(false)
  })

  it('rechaza null/undefined', () => {
    expect(verifySignature(secret, body, null)).toBe(false)
    expect(verifySignature(secret, body, undefined)).toBe(false)
  })

  it('rechaza secret vacío', () => {
    const sig = signPayload(secret, body)
    expect(verifySignature('', body, sig)).toBe(false)
  })

  it('rechaza header con longitud distinta (timing-safe-friendly)', () => {
    expect(verifySignature(secret, body, 'sha256=short')).toBe(false)
  })
})

describe('generateWebhookSecret', () => {
  it('produce 64 chars hex', () => {
    const s = generateWebhookSecret()
    expect(s).toMatch(/^[0-9a-f]{64}$/)
  })

  it('genera valores distintos en invocaciones consecutivas', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).not.toBe(b)
  })
})
