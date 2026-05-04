/**
 * Webhooks outbound (Ola P4 · Equipo P4-2) — firma HMAC SHA-256.
 *
 * Cada delivery incluye el header `X-FollowupGantt-Signature: sha256=<hex>`,
 * donde `<hex>` es `HMAC-SHA256(secret, body)`. El receptor recalcula la
 * firma con el secret compartido y compara timing-safe para evitar replay
 * con payload manipulado.
 *
 * Convención de naming alineada con GitHub/Stripe: el prefijo `sha256=` es
 * literal (NO base64). El cuerpo firmado es el body JSON serializado tal
 * cual lo recibe el receptor — DEBE firmarse el string exacto que se envía.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'X-FollowupGantt-Signature'
export const SIGNATURE_PREFIX = 'sha256='

/**
 * Calcula la firma del body con el secret. Devuelve el header completo
 * (`sha256=<hex>`). El caller pone esto directamente en el header.
 */
export function signPayload(secret: string, body: string): string {
  if (!secret || typeof secret !== 'string') {
    throw new Error('[INVALID_SECRET] secret requerido para firmar')
  }
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return `${SIGNATURE_PREFIX}${hex}`
}

/**
 * Verifica una firma recibida contra el body esperado. Devuelve booleano
 * timing-safe; nunca lanza por mismatch (los errores duros — secret vacío —
 * sí lanzan para forzar configuración correcta).
 */
export function verifySignature(
  secret: string,
  body: string,
  receivedHeader: string | null | undefined,
): boolean {
  if (!secret) return false
  if (!receivedHeader || typeof receivedHeader !== 'string') return false
  if (!receivedHeader.startsWith(SIGNATURE_PREFIX)) return false

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

/**
 * Genera un secret hex de 32 bytes (64 chars). Usado al crear webhooks.
 * El valor se persiste en BD (necesitamos firmar el body en el dispatcher);
 * a diferencia de los API tokens, aquí NO podemos hashearlo porque debemos
 * regenerar la firma en cada delivery.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}
