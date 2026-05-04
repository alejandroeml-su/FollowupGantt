'use server'

/**
 * Ola P5 · Equipo P5-5 — Server actions para AutomationRule + AutomationExecution.
 *
 * Errores tipados:
 *   `[INVALID_INPUT]`, `[RULE_NOT_FOUND]`, `[RULE_LOOP]`, `[FORBIDDEN]`,
 *   `[UNAUTHORIZED]`.
 *
 * Listados (`listRules`, `listExecutions`) protegidos por `requireUser`.
 *
 * Decisiones autónomas:
 *   D-FA-AUT-1: `runAutomationsAction` se exporta como server action para
 *           uso desde otros server actions (ej. `submitForm` lo llama
 *           directo del motor, pero workflows futuros desde la UI pueden
 *           dispararse via este wrapper).
 *   D-FA-AUT-2: La lista de ejecuciones acota a 200 por regla — auditoría
 *           reciente. La purga histórica queda para Ola P5+ (cron).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { parseRuleShape, safeParseRulePersisted } from '@/lib/automation/validation'
import {
  runAutomations,
  type ActionAdapter,
  type RunAutomationsDeps,
} from '@/lib/automation/engine'
import { prismaActionAdapter } from '@/lib/automation/prisma-adapter'
import type {
  AutomationContext,
  AutomationEvent,
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from '@/lib/automation/types'

// ─────────────────────────── Errores tipados ───────────────────────────

export type AutomationErrorCode =
  | 'INVALID_INPUT'
  | 'RULE_NOT_FOUND'
  | 'RULE_LOOP'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'

function actionError(code: AutomationErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ───────────────────────────

const nameSchema = z.string().trim().min(1).max(120)

const createRuleSchema = z.object({
  name: nameSchema,
  projectId: z.string().min(1).optional().nullable(),
  trigger: z.unknown(),
  conditions: z.unknown().optional(),
  actions: z.unknown(),
  isActive: z.boolean().optional().default(true),
})

export type CreateRuleInput = z.input<typeof createRuleSchema>

const updateRuleSchema = z
  .object({
    name: nameSchema.optional(),
    projectId: z.string().min(1).optional().nullable(),
    trigger: z.unknown().optional(),
    conditions: z.unknown().optional(),
    actions: z.unknown().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateRuleInput = z.input<typeof updateRuleSchema>

// ─────────────────────────── Helpers ───────────────────────────

function unwrapCreate(input: unknown) {
  const result = createRuleSchema.safeParse(input)
  if (!result.success) {
    actionError(
      'INVALID_INPUT',
      result.error.issues.map((i: { message: string }) => i.message).join('; '),
    )
  }
  return result.data
}

function unwrapUpdate(input: unknown) {
  const result = updateRuleSchema.safeParse(input)
  if (!result.success) {
    actionError(
      'INVALID_INPUT',
      result.error.issues.map((i: { message: string }) => i.message).join('; '),
    )
  }
  return result.data
}

function buildShapeFromInput(input: {
  trigger: unknown
  conditions?: unknown
  actions: unknown
}): {
  trigger: AutomationTrigger
  conditions: AutomationCondition[]
  actions: AutomationAction[]
} {
  try {
    return parseRuleShape({
      trigger: input.trigger,
      conditions: Array.isArray(input.conditions) ? input.conditions : [],
      actions: input.actions,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Shape inválido'
    actionError('INVALID_INPUT', msg)
  }
}

// ─────────────────────────── Lectura ───────────────────────────

export async function listRules() {
  await requireUser()
  return prisma.automationRule.findMany({
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { executions: true } },
    },
  })
}

export async function getRule(id: string) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const rule = await prisma.automationRule.findUnique({ where: { id } })
  if (!rule) actionError('RULE_NOT_FOUND', `Regla ${id} no encontrada`)
  return rule
}

export async function listExecutions(ruleId: string) {
  await requireUser()
  if (!ruleId) actionError('INVALID_INPUT', 'ruleId requerido')
  return prisma.automationExecution.findMany({
    where: { ruleId },
    orderBy: { executedAt: 'desc' },
    take: 200,
  })
}

// ─────────────────────────── Mutaciones ───────────────────────────

export async function createRule(input: CreateRuleInput) {
  await requireUser()
  const data = unwrapCreate(input)
  const shape = buildShapeFromInput({
    trigger: data.trigger,
    conditions: data.conditions,
    actions: data.actions,
  })

  const created = await prisma.automationRule.create({
    data: {
      name: data.name,
      projectId: data.projectId ?? null,
      trigger: shape.trigger as unknown as Prisma.InputJsonValue,
      conditions: shape.conditions as unknown as Prisma.InputJsonValue,
      actions: shape.actions as unknown as Prisma.InputJsonValue,
      isActive: data.isActive ?? true,
    },
  })

  revalidatePath('/settings/automation')
  return created
}

export async function updateRule(id: string, patch: UpdateRuleInput) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const data = unwrapUpdate(patch)
  const existing = await prisma.automationRule.findUnique({ where: { id } })
  if (!existing) actionError('RULE_NOT_FOUND', `Regla ${id} no encontrada`)

  const update: Prisma.AutomationRuleUpdateInput = {}
  if (data.name !== undefined) update.name = data.name
  if (data.projectId !== undefined) {
    update.project = data.projectId
      ? { connect: { id: data.projectId } }
      : { disconnect: true }
  }

  // Si tocan trigger/conditions/actions, re-validamos el shape combinado.
  if (
    data.trigger !== undefined ||
    data.conditions !== undefined ||
    data.actions !== undefined
  ) {
    const shape = buildShapeFromInput({
      trigger: data.trigger ?? existing.trigger,
      conditions:
        data.conditions ?? (Array.isArray(existing.conditions) ? existing.conditions : []),
      actions: data.actions ?? existing.actions,
    })
    if (data.trigger !== undefined) {
      update.trigger = shape.trigger as unknown as Prisma.InputJsonValue
    }
    if (data.conditions !== undefined) {
      update.conditions = shape.conditions as unknown as Prisma.InputJsonValue
    }
    if (data.actions !== undefined) {
      update.actions = shape.actions as unknown as Prisma.InputJsonValue
    }
  }

  const updated = await prisma.automationRule.update({ where: { id }, data: update })
  revalidatePath('/settings/automation')
  return updated
}

export async function toggleRule(id: string) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.automationRule.findUnique({ where: { id } })
  if (!existing) actionError('RULE_NOT_FOUND', `Regla ${id} no encontrada`)

  const updated = await prisma.automationRule.update({
    where: { id },
    data: { isActive: !existing.isActive },
  })
  revalidatePath('/settings/automation')
  return updated
}

export async function deleteRule(id: string) {
  await requireUser()
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.automationRule.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!existing) return // idempotente
  await prisma.automationRule.delete({ where: { id } })
  revalidatePath('/settings/automation')
}

// ─────────────────────────── Disparador genérico ───────────────────────────

/**
 * Trigger explícito de automatizaciones desde otros server actions.
 * `currentRuleId` previene el loop self-trigger (D-FA-3).
 */
export async function dispatchEvent(
  event: AutomationEvent,
  context: AutomationContext,
  currentRuleId?: string,
  adapter: ActionAdapter = prismaActionAdapter,
) {
  if (currentRuleId === context.triggeredBy) {
    actionError('RULE_LOOP', 'Una regla no puede dispararse a sí misma')
  }
  const deps: RunAutomationsDeps = {
    loadActiveRules: async () => {
      const rules = await prisma.automationRule.findMany({
        where: { isActive: true },
      })
      return rules
        .map((r) =>
          safeParseRulePersisted({
            id: r.id,
            name: r.name,
            isActive: r.isActive,
            trigger: r.trigger,
            conditions: r.conditions,
            actions: r.actions,
          }),
        )
        .filter((r): r is NonNullable<typeof r> => r !== null)
    },
    adapter,
    recordExecution: async (ruleId, triggeredBy, status, result) => {
      await prisma.automationExecution.create({
        data: {
          ruleId,
          triggeredBy,
          status,
          result: result as unknown as Prisma.InputJsonValue,
        },
      })
    },
    currentRuleId,
  }
  return runAutomations(event, context, deps)
}
