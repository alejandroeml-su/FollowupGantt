'use server'

import { redirect } from 'next/navigation'
import { confirmReset } from '@/lib/auth/password-reset'

export type ConfirmResetState =
  | { ok: true }
  | { ok: false; error: string }
  | undefined

/**
 * Confirma el reset. Si tiene éxito, redirige a `/login?reset=ok`.
 * Errores se mapean a strings en español para mostrar en la UI.
 */
export async function confirmResetAction(
  _prev: ConfirmResetState,
  formData: FormData,
): Promise<ConfirmResetState> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) {
    return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
  }
  if (password !== confirm) {
    return { ok: false, error: 'Las contraseñas no coinciden.' }
  }

  try {
    await confirmReset(token, password)
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('[TOKEN_EXPIRED]')) {
      return {
        ok: false,
        error: 'El enlace ha expirado. Solicita uno nuevo.',
      }
    }
    if (msg.includes('[TOKEN_INVALID]')) {
      return {
        ok: false,
        error: 'Enlace inválido o ya utilizado.',
      }
    }
    return { ok: false, error: 'No se pudo cambiar la contraseña.' }
  }

  redirect('/login?reset=ok')
}
