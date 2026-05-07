/**
 * Endpoint de diagnóstico SMTP/email — bypass del flujo de mention y
 * de cualquier bug del cliente (SW cacheado, mutations no entregadas).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` para no exponer abuso.
 *
 * GET  /api/admin/email-test                  → reporta el provider activo
 *                                                y la config SMTP visible
 *                                                (sin password).
 * POST /api/admin/email-test  { to?: string } → envía un correo real al
 *                                                destinatario indicado o
 *                                                al `EMAIL_FROM` por
 *                                                defecto, devuelve el
 *                                                resultado del provider
 *                                                (incluyendo error si
 *                                                M365 rechaza con
 *                                                `535 5.7.139` u otro).
 *
 * Uso típico:
 *   curl -X POST https://followup-gantt-beta.vercel.app/api/admin/email-test \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"to":"emartinez@complejoavante.com"}'
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  EMAIL_FROM,
  getActiveEmailProvider,
  sendEmail,
} from '@/lib/email/provider'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (secret) return auth === `Bearer ${secret}`
  // Sin secret configurado → permitimos sólo loopback (dev local).
  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

function smtpDiagnostics() {
  return {
    SMTP_HOST: process.env.SMTP_HOST || null,
    SMTP_PORT: process.env.SMTP_PORT || null,
    SMTP_SECURE: process.env.SMTP_SECURE || null,
    SMTP_USER: process.env.SMTP_USER || null,
    SMTP_PASSWORD_SET: Boolean(process.env.SMTP_PASSWORD),
    SENDGRID_API_KEY_SET: Boolean(process.env.SENDGRID_API_KEY),
    RESEND_API_KEY_SET: Boolean(process.env.RESEND_API_KEY),
    EMAIL_FROM,
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    activeProvider: getActiveEmailProvider(),
    config: smtpDiagnostics(),
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { to?: string; subject?: string } = {}
  try {
    body = await req.json()
  } catch {
    // body opcional — caemos al destinatario por defecto
  }

  const to =
    typeof body.to === 'string' && body.to.trim()
      ? body.to.trim()
      : 'emartinez@complejoavante.com'

  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim()
      : `[FollowupGantt] Smoke test ${new Date().toISOString()}`

  const result = await sendEmail({
    to,
    subject,
    text:
      `Este es un correo de prueba enviado desde el endpoint diagnóstico.\n\n` +
      `Provider activo: ${getActiveEmailProvider()}\n` +
      `Si recibiste este mensaje, el envío SMTP/SendGrid/Resend funciona.\n` +
      `\n— FollowupGantt`,
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a;">
<h1 style="font-size:18px;margin:0 0 12px;">Smoke test FollowupGantt</h1>
<p>Provider activo: <strong>${getActiveEmailProvider()}</strong></p>
<p>Si recibiste este mensaje, el envío de correo está funcionando.</p>
<p style="font-size:12px;color:#64748b;">Generado el ${new Date().toISOString()}</p>
</body></html>`,
    tags: [{ name: 'type', value: 'admin-smoke-test' }],
  })

  // No exponemos el reason completo si es un error con info sensible;
  // pero para diagnóstico sí queremos ver `535 5.7.139`, etc.
  return NextResponse.json(
    {
      ...result,
      diagnostics: {
        activeProvider: getActiveEmailProvider(),
        to,
        subject,
        config: smtpDiagnostics(),
      },
    },
    { status: result.sent ? 200 : 502 },
  )
}
