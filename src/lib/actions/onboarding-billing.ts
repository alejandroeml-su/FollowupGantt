'use server'

/**
 * Wave R4-E · Server actions del flow post-signup.
 *
 * Mantiene `markOnboardingCompleted` cerca del módulo de billing para que
 * el modal `PostSignupFlow` lo consuma sin duplicar la lógica. La lógica
 * de invitación reusa `inviteMember` (workspaces.ts) — exportamos un
 * wrapper que invoca y formatea el resultado al shape del modal.
 */

import { z } from 'zod'

import {
  inviteMember as inviteMemberCore,
} from '@/lib/actions/workspaces'
import { requireWorkspaceAccess } from '@/lib/auth/check-workspace-access'
import { markOnboardingCompleted as markOnboardingCompletedCore } from '@/lib/billing/subscription'

const completeSchema = z.object({
  workspaceId: z.string().min(1),
})

const inviteSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email(),
})

/**
 * Marca `Workspace.onboardingCompletedAt` cuando el usuario cierra el modal.
 * Idempotente (mismo helper que el módulo de billing).
 */
export async function markOnboardingCompletedAction(workspaceId: string): Promise<void> {
  const parsed = completeSchema.safeParse({ workspaceId })
  if (!parsed.success) throw new Error('[INVALID_INPUT] workspaceId requerido')
  await requireWorkspaceAccess(parsed.data.workspaceId)
  await markOnboardingCompletedCore(parsed.data.workspaceId)
}

/**
 * Wrapper de `inviteMember` para el modal de onboarding. Devuelve solo
 * `{ ok: boolean }` para no exponer el token a través del wire del cliente.
 */
export async function inviteFromOnboarding(input: {
  workspaceId: string
  email: string
}): Promise<{ ok: true }> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(
      `[INVALID_INPUT] ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    )
  }
  await inviteMemberCore({
    workspaceId: parsed.data.workspaceId,
    email: parsed.data.email,
  })
  return { ok: true }
}
