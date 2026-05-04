'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { isSuperAdmin } from '@/lib/auth/permissions'
import { generateSecret, verifyCode, buildOtpAuthUrl } from '@/lib/auth/totp'

/**
 * Server actions del flujo 2FA TOTP (Ola P3).
 *
 *   - `prepareTwoFactorAction()`: genera un secret efímero y devuelve
 *     la otpauth URI para QR. NO persiste hasta que el usuario
 *     verifique con un código (`enableTwoFactorAction`).
 *   - `enableTwoFactorAction(secret, code)`: si el código verifica,
 *     persiste `User.twoFactorSecret`.
 *   - `disableTwoFactorAction()`: setea `twoFactorSecret = null`.
 *
 * Errores tipados: `[INVALID_TOTP]`, `[FORBIDDEN]`.
 */

const enableSchema = z.object({
  secret: z.string().min(16),
  code: z.string().regex(/^\d{6}$/, 'Código de 6 dígitos'),
})

export async function prepareTwoFactorAction(): Promise<{
  secret: string
  otpAuthUrl: string
}> {
  const user = await requireUser()
  if (!isSuperAdmin(user.roles)) {
    throw new Error('[FORBIDDEN] 2FA solo disponible para SUPER_ADMIN')
  }
  const secret = generateSecret()
  const otpAuthUrl = buildOtpAuthUrl({
    secret,
    accountName: user.email,
    issuer: 'FollowupGantt',
  })
  return { secret, otpAuthUrl }
}

export type EnableTwoFactorState =
  | { ok: true }
  | { ok: false; error: string }
  | undefined

export async function enableTwoFactorAction(
  _prev: EnableTwoFactorState,
  formData: FormData,
): Promise<EnableTwoFactorState> {
  const user = await requireUser()
  if (!isSuperAdmin(user.roles)) {
    return { ok: false, error: 'No autorizado.' }
  }

  const parsed = enableSchema.safeParse({
    secret: formData.get('secret'),
    code: formData.get('code'),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
    }
  }

  const { secret, code } = parsed.data
  if (!verifyCode(secret, code)) {
    return { ok: false, error: 'Código inválido. Verifica la hora del dispositivo.' }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: secret },
  })

  revalidatePath('/settings/2fa')
  return { ok: true }
}

export async function disableTwoFactorAction(): Promise<void> {
  const user = await requireUser()
  if (!isSuperAdmin(user.roles)) {
    throw new Error('[FORBIDDEN] 2FA solo disponible para SUPER_ADMIN')
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: null },
  })
  revalidatePath('/settings/2fa')
}
