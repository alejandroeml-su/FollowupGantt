'use server'

import { revalidatePath } from 'next/cache'
import { revokeSession, revokeOtherSessions } from '@/lib/auth/sessions'

/**
 * Server actions para la página de sesiones (Ola P3).
 *
 * Diseñadas para usarse con `<form action={...}>` directamente — no
 * devuelven estado, sólo `revalidatePath` para refrescar la lista.
 */

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const sessionId = String(formData.get('sessionId') ?? '')
  await revokeSession(sessionId)
  revalidatePath('/settings/sessions')
}

export async function revokeOtherSessionsAction(): Promise<void> {
  await revokeOtherSessions()
  revalidatePath('/settings/sessions')
}
