import { Resend } from 'resend'

let client: Resend | null | undefined

/**
 * Devuelve un cliente Resend singleton.
 *
 * Si `RESEND_API_KEY` no está configurada, devuelve `null` y los correos
 * no se envían (el código de notificaciones debe degradar elegantemente).
 */
export function getResendClient(): Resend | null {
  if (client !== undefined) return client
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY no configurada. Los correos no se enviarán.')
    client = null
    return null
  }
  client = new Resend(apiKey)
  return client
}

/**
 * Remitente por defecto para los correos transaccionales.
 *
 * P3-5 · Hardening pre-producción · Verificación de dominio Avante
 * ─────────────────────────────────────────────────────────────────
 * El default ahora apunta a `notifications@complejoavante.com`. Antes de
 * habilitarlo en producción, SRE/Edwin deben verificar el dominio en
 * Resend siguiendo estos pasos (deuda registrada P3-5.A):
 *
 *   1. Dashboard Resend → Domains → Add Domain → `complejoavante.com`.
 *   2. Resend genera 3 registros DNS:
 *        - 1 TXT  `_resend.complejoavante.com` (verificación de propiedad)
 *        - 1 TXT  `<selector>._domainkey.complejoavante.com` (DKIM)
 *        - 1 MX o TXT en `send.complejoavante.com` (Return-Path / SPF)
 *   3. Crear esos registros en el proveedor DNS de Avante (Cloudflare /
 *      proveedor corporativo) — el equipo de redes de Avante puede
 *      necesitar ticket interno; propagación típica: 5-30 min.
 *   4. Click "Verify DNS Records" en Resend. Estado debe pasar a
 *      `verified`.
 *   5. Crear el alias `notifications@complejoavante.com` en el proveedor
 *      de correo corporativo (M365 / Google Workspace) o configurar como
 *      remitente "send-only" sin buzón si no se requieren respuestas.
 *   6. Configurar `EMAIL_FROM="FollowupGantt <notifications@complejoavante.com>"`
 *      en Vercel (Settings → Environment Variables → Production).
 *   7. Smoke test: enviar un correo a una cuenta @complejoavante.com y
 *      verificar header `Authentication-Results` = `dkim=pass spf=pass`.
 *
 * Mientras el dominio NO esté verificado, sobrescribir `EMAIL_FROM` con
 * `onboarding@resend.dev` (sandbox) en Vercel para que los envíos no
 * fallen en producción. En sandbox Resend solo entrega al email del
 * dueño de la cuenta — sirve para QA pero no para usuarios finales.
 */
export const EMAIL_FROM =
  process.env.EMAIL_FROM || 'FollowupGantt <notifications@complejoavante.com>'

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
