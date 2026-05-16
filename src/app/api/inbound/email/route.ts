/**
 * R4 · US-7.4 · POST /api/inbound/email
 *
 * Webhook receptor de SendGrid Inbound Parse. Convierte el `multipart/form-data`
 * en una task nueva o un comentario sobre task existente, dependiendo de si
 * el subject incluye `[#MNEMONIC]`.
 *
 * Seguridad:
 *   - HMAC SHA-256 con `SENDGRID_INBOUND_SECRET`. SendGrid no firma de forma
 *     nativa el payload, así que la documentación al operador (ver
 *     `docs/integrations/email-to-task.md`) indica configurar un parámetro
 *     `?secret=<HMAC>` en la URL Inbound Parse de SendGrid. Validamos que
 *     el valor recibido haga match contra `SENDGRID_INBOUND_SECRET` con
 *     comparación constant-time.
 *   - Como fallback (entornos sin DNS aún), aceptamos el secret en header
 *     `X-Sync-Inbound-Secret`. Documentado en el `.md`.
 *
 * Idempotencia:
 *   - SendGrid Inbound Parse no reenvía si responde 2xx; aceptamos
 *     posible duplicado (raro) y NO deduplicamos por `Message-ID` en
 *     esta primera versión — deuda registrada.
 *
 * Respuesta:
 *   - Siempre devuelve `200 { ok: true, status }` salvo cuando falla la
 *     firma (401) o el body no es FormData (400). Razón: SendGrid
 *     reintenta agresivamente ante 5xx; preferimos persistir el row con
 *     `status=FAILED` y NO inducir loops.
 */

import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { normalizeSendgridPayload } from '@/lib/email/inbound-parser'
import { getInboundEmailDomain } from '@/lib/email/inbound-alias'
import { processInboundEmail } from '@/lib/actions/inbound-email'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Cap defensivo del payload bruto (SendGrid envía hasta 30 MB con
// attachments; Next/Node default acepta sin problema, pero validamos).
const MAX_PAYLOAD_BYTES = 35 * 1024 * 1024

export async function POST(request: NextRequest) {
  // 1. Validar firma / secret.
  const verified = verifyInboundSecret(request)
  if (!verified.ok) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: verified.reason } },
      { status: 401 },
    )
  }

  // 2. Validar content-type.
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Se esperaba multipart/form-data (SendGrid Inbound Parse)',
        },
      },
      { status: 400 },
    )
  }

  // 3. Validar tamaño aproximado.
  const lengthHeader = request.headers.get('content-length')
  if (lengthHeader) {
    const length = Number(lengthHeader)
    if (Number.isFinite(length) && length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Body excede ${MAX_PAYLOAD_BYTES} bytes`,
          },
        },
        { status: 413 },
      )
    }
  }

  // 4. Parsear FormData.
  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    return NextResponse.json(
      {
        error: {
          code: 'PARSE_FAILED',
          message: `No se pudo parsear multipart/form-data: ${msg}`,
        },
      },
      { status: 400 },
    )
  }

  // 5. Normalizar payload.
  const inboundDomain = getInboundEmailDomain()
  const parsed = normalizeSendgridPayload(form, inboundDomain)

  // 6. Procesar (idempotente por construcción — siempre persiste un row).
  const result = await processInboundEmail(parsed)

  // 7. Responder 200 incluso si hubo error de negocio (ya quedó persistido
  // para retry manual). Sólo 5xx en bugs inesperados que el caller no pueda
  // observar — actualmente `processInboundEmail` jamás throws.
  return NextResponse.json(
    {
      ok: result.status === 'PROCESSED',
      status: result.status,
      inboundEmailId: result.inboundEmailId,
      taskId: result.taskId,
      commentId: result.commentId,
      errorCode: result.errorCode,
    },
    { status: 200 },
  )
}

// ───────────────────────── Helpers de firma ─────────────────────────

type VerifyResult = { ok: true } | { ok: false; reason: string }

function verifyInboundSecret(request: NextRequest): VerifyResult {
  const expectedSecret = process.env.SENDGRID_INBOUND_SECRET
  if (!expectedSecret) {
    return {
      ok: false,
      reason: 'SENDGRID_INBOUND_SECRET no configurado en el server',
    }
  }

  // Modo simple: secret en query `?secret=<value>` o header
  // `X-Sync-Inbound-Secret`. Comparación constant-time.
  const url = new URL(request.url)
  const fromQuery = url.searchParams.get('secret')
  const fromHeader = request.headers.get('x-sync-inbound-secret')
  const candidate = fromQuery ?? fromHeader

  if (candidate) {
    if (safeEqual(candidate, expectedSecret)) return { ok: true }
    return { ok: false, reason: 'Secret recibido no coincide' }
  }

  // Modo HMAC (avanzado): firma calculada sobre el ts + signed-event-id.
  // Documentado en el .md por si SendGrid añade firma nativa en el futuro.
  const ts = request.headers.get('x-sendgrid-timestamp')
  const signature = request.headers.get('x-sendgrid-signature')
  if (ts && signature) {
    const hmac = createHmac('sha256', expectedSecret).update(ts).digest('hex')
    if (safeEqual(hmac, signature)) return { ok: true }
    return { ok: false, reason: 'Firma HMAC inválida' }
  }

  return {
    ok: false,
    reason:
      'Falta `?secret=` o header `X-Sync-Inbound-Secret` para autenticar el webhook',
  }
}

/**
 * Comparación constant-time de dos strings ASCII. Devuelve `false` si
 * difieren en longitud sin tocar `timingSafeEqual` (que requiere buffers
 * del mismo tamaño y throws si difieren).
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
