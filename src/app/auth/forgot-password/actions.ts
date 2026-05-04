'use server'

import { z } from 'zod'
import { requestReset } from '@/lib/auth/password-reset'

const schema = z.object({
  email: z.string().email().trim().toLowerCase(),
})

/**
 * Server action que dispara el envío del email de recuperación.
 * Devuelve siempre `{ ok: true }` para no filtrar si el email existe.
 */
export async function requestPasswordResetAction(
  email: string,
): Promise<{ ok: true }> {
  const parsed = schema.safeParse({ email })
  if (!parsed.success) {
    // Aún en input inválido devolvemos `ok: true` para mantener
    // simetría con el flujo exitoso (no leak).
    return { ok: true }
  }
  await requestReset(parsed.data.email)
  return { ok: true }
}
