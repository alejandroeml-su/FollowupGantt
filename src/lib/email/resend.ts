import { Resend } from 'resend'

let client: Resend | null | undefined

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

export const EMAIL_FROM = process.env.EMAIL_FROM || 'FollowupGantt <onboarding@resend.dev>'
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
