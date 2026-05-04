'use server'

/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Server Actions.
 *
 * Expone:
 *   - `generateProjectStandup({ projectId, ... })` — guard `requireProjectAccess`.
 *   - `generateUserStandup({ userId?, ... })` — usa el current user si no se pasa.
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] detalle`.
 *   - Validación zod del input.
 *   - `revalidatePath('/standup')` tras regeneración manual.
 *   - Sin Prisma writes — sólo lectura. El cache vive en memoria del proceso.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { requireUser } from '@/lib/auth/get-current-user'
import {
  buildProjectStandupContext,
  buildUserStandupContext,
} from '@/lib/ai/standup/build-standup-context'
import {
  generateStandup,
  type GenerateStandupOptions,
} from '@/lib/ai/standup/generate-standup'
import type { Standup } from '@/lib/ai/standup/standup-schema'

// ─────────────────────────── Errores tipados ───────────────────────────

export type StandupErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

function actionError(code: StandupErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ───────────────────────────────────

const optionsSchema = z
  .object({
    tone: z.enum(['formal', 'casual']).optional(),
    format: z.enum(['standup', 'briefing']).optional(),
    lang: z.enum(['es', 'en']).optional(),
    force: z.boolean().optional(),
    /** Override de "now" en formato ISO (sólo se acepta en dev/tests). */
    nowIso: z.string().datetime().optional(),
  })
  .strict()

const projectInputSchema = z
  .object({
    projectId: z.string().min(1, 'projectId es obligatorio'),
  })
  .merge(optionsSchema)

const userInputSchema = z
  .object({
    userId: z.string().min(1).optional(),
  })
  .merge(optionsSchema)

export type GenerateProjectStandupInput = z.infer<typeof projectInputSchema>
export type GenerateUserStandupInput = z.infer<typeof userInputSchema>

// ─────────────────────────── Helpers ───────────────────────────────────

function pickGeneratorOptions(
  parsed: z.infer<typeof optionsSchema>,
): Pick<GenerateStandupOptions, 'tone' | 'format' | 'lang' | 'force'> {
  return {
    tone: parsed.tone,
    format: parsed.format,
    lang: parsed.lang,
    force: parsed.force,
  }
}

function nowFromInput(parsed: z.infer<typeof optionsSchema>): Date | undefined {
  if (!parsed.nowIso) return undefined
  // Sólo en dev/tests permitimos override del reloj.
  if (process.env.NODE_ENV === 'production') return undefined
  return new Date(parsed.nowIso)
}

// ─────────────────────────── Actions ───────────────────────────────────

/**
 * Genera el standup de un proyecto. Aplica `requireProjectAccess` para
 * impedir leakage entre tenants. Si el proyecto no existe, retorna
 * `[NOT_FOUND]`.
 */
export async function generateProjectStandup(
  input: GenerateProjectStandupInput,
): Promise<Standup> {
  const parsed = projectInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  await requireProjectAccess(parsed.data.projectId)

  const ctx = await buildProjectStandupContext(parsed.data.projectId, {
    now: nowFromInput(parsed.data),
  })
  const standup = await generateStandup(ctx, pickGeneratorOptions(parsed.data))

  if (parsed.data.force) {
    revalidatePath('/standup')
  }
  return standup
}

/**
 * Genera el standup de un usuario individual. Por default usa el current
 * user; un admin puede pasar `userId` explícito. Si el caller pasa un
 * `userId` distinto al suyo y no es admin, retorna `[FORBIDDEN]`.
 */
export async function generateUserStandup(
  input: GenerateUserStandupInput = {},
): Promise<Standup> {
  const parsed = userInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const me = await requireUser()
  const targetUserId = parsed.data.userId ?? me.id

  // Sólo admins pueden ver standup ajeno.
  if (targetUserId !== me.id) {
    const isAdmin = me.roles.some(
      (r) => r === 'ADMIN' || r === 'SUPER_ADMIN',
    )
    if (!isAdmin) {
      actionError('FORBIDDEN', 'no puedes ver el standup de otro usuario')
    }
  }

  const ctx = await buildUserStandupContext(targetUserId, {
    now: nowFromInput(parsed.data),
  })
  const standup = await generateStandup(ctx, pickGeneratorOptions(parsed.data))

  if (parsed.data.force) {
    revalidatePath('/standup')
  }
  return standup
}
