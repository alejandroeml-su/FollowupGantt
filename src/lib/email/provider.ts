/**
 * Provider abstracto de envío de correo.
 *
 * Estrategia de selección (primer adapter disponible gana):
 *   1. SMTP genérico (nodemailer) — preferido para M365 corporativo,
 *      remitente nativo @complejoavante.com con SPF/DKIM del tenant.
 *   2. SendGrid Single Sender — fallback cuando el tenant M365 bloquea
 *      SMTP AUTH (Basic Auth disabled). Single Sender no requiere DNS.
 *   3. Resend — modo histórico, requiere dominio verificado en Resend.
 *
 * Si ninguno está configurado, devuelve `{ sent: false, reason }` para
 * que el caller degrade elegantemente (la app no debe romperse cuando
 * no hay proveedor — los emails son notificaciones, no flujo crítico).
 *
 * Diseño intencional: contrato unificado `SendEmailInput` que cualquier
 * adapter sabe traducir a su API. Los `tags` se mapean a `categories`
 * en SendGrid y a un header `X-Entity-Tags` en SMTP.
 */

import { isSmtpAvailable, smtpSend } from './smtp'
import { isSendgridAvailable, sendgridSend } from './sendgrid'
import { getResendClient, EMAIL_FROM, APP_URL } from './resend'

export { EMAIL_FROM, APP_URL }

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  /** Default: `EMAIL_FROM`. Sobrescribir sólo si hay razón concreta. */
  from?: string
  tags?: { name: string; value: string }[]
  replyTo?: string
}

export type SendEmailResult =
  | { sent: true; provider: EmailProviderName; messageId?: string }
  | { sent: false; reason: string; provider?: EmailProviderName }

export type EmailProviderName = 'smtp' | 'sendgrid' | 'resend' | 'none'

/**
 * Devuelve el nombre del adapter activo. Útil para healthchecks
 * (`/api/admin/email-status`) y logging.
 */
export function getActiveEmailProvider(): EmailProviderName {
  if (isSmtpAvailable()) return 'smtp'
  if (isSendgridAvailable()) return 'sendgrid'
  if (process.env.RESEND_API_KEY) return 'resend'
  return 'none'
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const from = input.from ?? EMAIL_FROM
  const provider = getActiveEmailProvider()

  if (provider === 'smtp') {
    const r = await smtpSend({ ...input, from })
    return r.sent
      ? { sent: true, provider: 'smtp', messageId: r.messageId }
      : { sent: false, provider: 'smtp', reason: r.reason }
  }

  if (provider === 'sendgrid') {
    const r = await sendgridSend({ ...input, from })
    return r.sent
      ? { sent: true, provider: 'sendgrid', messageId: r.messageId }
      : { sent: false, provider: 'sendgrid', reason: r.reason }
  }

  if (provider === 'resend') {
    const resend = getResendClient()
    if (!resend) {
      return { sent: false, provider: 'resend', reason: 'RESEND_CLIENT_INIT_FAILED' }
    }
    try {
      const result = await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      })
      if (result.error) {
        return { sent: false, provider: 'resend', reason: result.error.message }
      }
      return { sent: true, provider: 'resend', messageId: result.data?.id }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN'
      return { sent: false, provider: 'resend', reason }
    }
  }

  return { sent: false, provider: 'none', reason: 'NO_EMAIL_PROVIDER_CONFIGURED' }
}
