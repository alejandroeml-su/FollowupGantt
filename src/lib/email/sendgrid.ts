/**
 * Adapter SendGrid para envío de correos transaccionales.
 *
 * Activa cuando `SENDGRID_API_KEY` está configurada. Tiene preferencia
 * sobre Resend si ambos están definidos (ver `provider.ts`).
 *
 * Modo de uso recomendado: SendGrid Single Sender Verification — el
 * usuario verifica una dirección concreta (ej. `proyecto@complejoavante.com`)
 * sin requerir cambios DNS. Funciona porque SendGrid usa SU SPF/DKIM
 * para el envío y la dirección verificada se firma legítimamente.
 *
 * Limitaciones del modo Single Sender:
 *   - El header técnico mostrará "via sendgrid.net" en algunos clientes
 *     (Gmail). El From visible es el verificado.
 *   - 100 emails/día gratis. Upgrade $20/mes para más.
 */

import sgMail, { type MailDataRequired } from '@sendgrid/mail'

let initialized = false
let available = false

function ensureInit(): boolean {
  if (initialized) return available
  initialized = true
  const apiKey = process.env.SENDGRID_API_KEY?.trim()
  if (!apiKey) {
    available = false
    return false
  }
  sgMail.setApiKey(apiKey)
  available = true
  return true
}

export function isSendgridAvailable(): boolean {
  return ensureInit()
}

export type SendgridSendInput = {
  to: string
  from: string
  subject: string
  html: string
  text: string
  /** Mapa key→value de etiquetas/categorías (Resend usa `tags[]`,
   * SendGrid las llama `categories[]`). Convertimos al equivalente. */
  tags?: { name: string; value: string }[]
  replyTo?: string
}

export type SendgridSendResult =
  | { sent: true; messageId?: string }
  | { sent: false; reason: string }

/**
 * Envía un correo via SendGrid. No-op silencioso si no está configurado
 * (devuelve `{ sent: false, reason }` para que el caller decida).
 */
export async function sendgridSend(
  input: SendgridSendInput,
): Promise<SendgridSendResult> {
  if (!ensureInit()) {
    return { sent: false, reason: 'SENDGRID_API_KEY_MISSING' }
  }

  // Convertir tags a categorías (SendGrid sólo soporta strings, no key=value).
  const categories = (input.tags ?? []).map((t) => `${t.name}:${t.value}`)

  const message: MailDataRequired = {
    to: input.to,
    from: input.from,
    subject: input.subject,
    text: input.text,
    html: input.html,
    ...(categories.length > 0 ? { categories } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  }

  try {
    const [response] = await sgMail.send(message)
    const messageId =
      response.headers?.['x-message-id'] ??
      (response.headers?.['X-Message-Id'] as string | undefined)
    return { sent: true, messageId }
  } catch (err) {
    // sgMail lanza con .response.body cuando hay error 4xx/5xx
    const detail =
      err instanceof Error
        ? // @ts-expect-error — el cuerpo del error de SendGrid es dinámico
          (err.response?.body?.errors?.[0]?.message ?? err.message)
        : String(err)
    console.error('[email] SendGrid rechazó el envío', { to: input.to, detail })
    return { sent: false, reason: detail }
  }
}
