/**
 * Adapter SMTP genérico (nodemailer) para envío de correos transaccionales.
 *
 * Pensado para Microsoft 365 corporativo (`smtp.office365.com:587`) con
 * el buzón `proyecto@complejoavante.com`, pero sirve para cualquier
 * proveedor SMTP autenticado (Gmail, Zoho, etc.) configurando las env vars.
 *
 * Activación: cuando `SMTP_HOST` + `SMTP_USER` + `SMTP_PASSWORD` están
 * configuradas. Tiene preferencia sobre SendGrid y Resend (ver `provider.ts`).
 *
 * Ventaja vs. SendGrid: los correos salen nativamente desde
 * `@complejoavante.com` con SPF/DKIM gestionados por M365 — sin
 * "via sendgrid.net" en el header de Gmail.
 *
 * Caveat M365: si el tenant tiene "SmtpClientAuthentication disabled"
 * (default en tenants nuevos), nodemailer recibirá `535 5.7.139` y
 * `provider.ts` caerá automáticamente al siguiente adapter.
 */

import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | null | undefined

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

function readConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim()
  const user = process.env.SMTP_USER?.trim()
  const password = process.env.SMTP_PASSWORD
  if (!host || !user || !password) return null

  const portRaw = process.env.SMTP_PORT?.trim()
  const port = portRaw ? Number.parseInt(portRaw, 10) : 587
  if (Number.isNaN(port)) return null

  // Convención: 465 = TLS implícito (secure=true); 587 = STARTTLS (secure=false).
  const secureEnv = process.env.SMTP_SECURE?.trim().toLowerCase()
  const secure =
    secureEnv === 'true' ? true : secureEnv === 'false' ? false : port === 465

  return { host, port, secure, user, password }
}

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter
  const cfg = readConfig()
  if (!cfg) {
    transporter = null
    return null
  }
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    // Evita que el handshake bloquee la request si el server SMTP
    // está caído. 10s es suficiente para M365 y Gmail.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  return transporter
}

export function isSmtpAvailable(): boolean {
  return getTransporter() !== null
}

export type SmtpSendInput = {
  to: string
  from: string
  subject: string
  html: string
  text: string
  /** Tags se serializan en header `X-Entity-Tags` (uso interno/debug). */
  tags?: { name: string; value: string }[]
  replyTo?: string
}

export type SmtpSendResult =
  | { sent: true; messageId?: string }
  | { sent: false; reason: string }

export async function smtpSend(input: SmtpSendInput): Promise<SmtpSendResult> {
  const tx = getTransporter()
  if (!tx) return { sent: false, reason: 'SMTP_NOT_CONFIGURED' }

  const headers: Record<string, string> = {}
  if (input.tags && input.tags.length > 0) {
    headers['X-Entity-Tags'] = input.tags
      .map((t) => `${t.name}=${t.value}`)
      .join('; ')
  }

  try {
    const info = await tx.sendMail({
      to: input.to,
      from: input.from,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      headers,
    })
    return { sent: true, messageId: info.messageId }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[email] SMTP rechazó el envío', { to: input.to, reason })
    return { sent: false, reason }
  }
}
