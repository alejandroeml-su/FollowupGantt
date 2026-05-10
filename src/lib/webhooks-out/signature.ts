/**
 * Wave P17-B · Firma HMAC-SHA256 para webhooks v2.
 *
 * Header canónico: `X-Signature-256: sha256=<hex>` (alineado con GitHub).
 * El receptor recalcula `HMAC-SHA256(secret, body)` y compara timing-safe.
 *
 * Tests: el helper `verifySignature` se usa unit-test friendly; `signPayload`
 * lanza si el secret es vacío (forzar config explícita).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const V2_SIGNATURE_HEADER = 'X-Signature-256'
export const V2_SIGNATURE_PREFIX = 'sha256='

export function signPayload(secret: string, body: string): string {
  if (!secret || typeof secret !== 'string') {
    throw new Error('[INVALID_SECRET] secret requerido para firmar')
  }
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return `${V2_SIGNATURE_PREFIX}${hex}`
}

export function verifySignature(
  secret: string,
  body: string,
  receivedHeader: string | null | undefined,
): boolean {
  if (!secret) return false
  if (!receivedHeader || typeof receivedHeader !== 'string') return false
  if (!receivedHeader.startsWith(V2_SIGNATURE_PREFIX)) return false

  const expected = signPayload(secret, body)
  if (expected.length !== receivedHeader.length) return false
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(receivedHeader, 'utf8'),
    )
  } catch {
    return false
  }
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}
