'use server'

/**
 * Ola P2 · Equipo P2-3 — Server actions para `RecurrenceRule`.
 *
 * Configura reglas de recurrencia (subset RRULE) sobre `TaskTemplate`. La
 * generación de tasks la dispara `scheduleAll` (cron / `/api/cron/recurrence`),
 * estas actions sólo administran el ciclo de vida de las reglas:
 *
 *   - createRule       → da de alta + valida shape via `validateRule`.
 *   - updateRule       → patch parcial; valida re-shape post-merge.
 *   - pauseRule(rule)  → toggle `active` (pause/resume).
 *   - deleteRule       → cascade no afecta tasks generadas (FK SET NULL).
 *   - generateOverdueOccurrences(ruleId) → catch-up por una sola regla
 *                       (idempotente, delega en `instantiateFromTemplate`).
 *
 * Convenciones del repo: `[INVALID_RRULE]`, `[RULE_NOT_FOUND]`,
 * `[TEMPLATE_NOT_FOUND]`, `[INVALID_INPUT]`. Todas las mutaciones
 * `revalidatePath('/templates')` para refrescar la lista.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { RecurrenceRule } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  validateRule,
  expandOccurrences,
  type RRule,
  type RecurrenceFreq,
} from '@/lib/recurrence/rrule'
import { instantiateFromTemplate } from '@/lib/actions/templates'

// ─────────────────────────── Errores tipados ───────────────────────────

export type RecurrenceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_RRULE'
  | 'RULE_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'

function actionError(code: RecurrenceErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

function flattenZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
}

// ─────────────────────────── Schemas ───────────────────────────

const FREQ_ENUM = z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])

// Aceptamos `Date` o ISO-string en startDate/endDate; lo normalizamos
// antes de pasarlo a `validateRule`.
const dateLike = z.union([
  z.date(),
  z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'fecha inválida' }),
])

const createRuleSchema = z.object({
  templateId: z.string().min(1),
  frequency: FREQ_ENUM,
  interval: z.number().int().min(1).max(999).optional().default(1),
  byweekday: z.array(z.number().int().min(0).max(6)).optional().default([]),
  bymonthday: z.array(z.number().int().min(1).max(31)).optional().default([]),
  startDate: dateLike,
  endDate: dateLike.nullish(),
  count: z.number().int().min(1).max(5000).nullish(),
  active: z.boolean().optional().default(true),
})

export type CreateRuleInput = z.input<typeof createRuleSchema>

const updateRuleSchema = z
  .object({
    frequency: FREQ_ENUM.optional(),
    interval: z.number().int().min(1).max(999).optional(),
    byweekday: z.array(z.number().int().min(0).max(6)).optional(),
    bymonthday: z.array(z.number().int().min(1).max(31)).optional(),
    startDate: dateLike.optional(),
    endDate: dateLike.nullish(),
    count: z.number().int().min(1).max(5000).nullish(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateRuleInput = z.input<typeof updateRuleSchema>

// ─────────────────────────── Helpers ───────────────────────────

function toDate(input: Date | string): Date {
  if (input instanceof Date) return input
  return new Date(input)
}

function toRRule(rule: {
  frequency: RecurrenceFreq
  interval: number
  byweekday: number[]
  bymonthday: number[]
  startDate: Date
  endDate: Date | null
  count: number | null
}): RRule {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    byweekday: rule.byweekday,
    bymonthday: rule.bymonthday,
    startDate: rule.startDate,
    endDate: rule.endDate ?? null,
    count: rule.count ?? null,
  }
}

// ─────────────────────────── Reads ───────────────────────────

export async function listRulesForTemplate(templateId: string): Promise<RecurrenceRule[]> {
  if (!templateId) actionError('INVALID_INPUT', 'templateId requerido')
  return prisma.recurrenceRule.findMany({
    where: { templateId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getRule(id: string): Promise<RecurrenceRule | null> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  return prisma.recurrenceRule.findUnique({ where: { id } })
}

// ─────────────────────────── Mutations ───────────────────────────

export async function createRule(input: CreateRuleInput): Promise<RecurrenceRule> {
  const parsed = createRuleSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', flattenZodError(parsed.error))
  const data = parsed.data

  const template = await prisma.taskTemplate.findUnique({
    where: { id: data.templateId },
    select: { id: true },
  })
  if (!template) actionError('TEMPLATE_NOT_FOUND', `Template ${data.templateId} no existe`)

  const start = toDate(data.startDate)
  const end = data.endDate ? toDate(data.endDate) : null

  const v = validateRule({
    frequency: data.frequency,
    interval: data.interval,
    byweekday: data.byweekday,
    bymonthday: data.bymonthday,
    startDate: start,
    endDate: end,
    count: data.count ?? null,
  })
  if (!v.ok) actionError('INVALID_RRULE', v.errors.join('; '))

  const created = await prisma.recurrenceRule.create({
    data: {
      templateId: data.templateId,
      frequency: data.frequency,
      interval: data.interval,
      byweekday: data.byweekday,
      bymonthday: data.bymonthday,
      startDate: start,
      endDate: end,
      count: data.count ?? null,
      active: data.active ?? true,
    },
  })

  revalidatePath('/templates')
  return created
}

export async function updateRule(
  id: string,
  input: UpdateRuleInput,
): Promise<RecurrenceRule> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const parsed = updateRuleSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', flattenZodError(parsed.error))

  const existing = await prisma.recurrenceRule.findUnique({ where: { id } })
  if (!existing) actionError('RULE_NOT_FOUND', `Regla ${id} no existe`)

  const data = parsed.data
  const merged = {
    frequency: (data.frequency ?? existing.frequency) as RecurrenceFreq,
    interval: data.interval ?? existing.interval,
    byweekday: data.byweekday ?? existing.byweekday,
    bymonthday: data.bymonthday ?? existing.bymonthday,
    startDate: data.startDate !== undefined ? toDate(data.startDate) : existing.startDate,
    endDate:
      data.endDate === undefined
        ? existing.endDate
        : data.endDate === null
          ? null
          : toDate(data.endDate),
    count: data.count === undefined ? existing.count : data.count,
  }

  const v = validateRule(merged)
  if (!v.ok) actionError('INVALID_RRULE', v.errors.join('; '))

  const updated = await prisma.recurrenceRule.update({
    where: { id },
    data: {
      ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
      ...(data.interval !== undefined ? { interval: data.interval } : {}),
      ...(data.byweekday !== undefined ? { byweekday: data.byweekday } : {}),
      ...(data.bymonthday !== undefined ? { bymonthday: data.bymonthday } : {}),
      ...(data.startDate !== undefined ? { startDate: merged.startDate } : {}),
      ...(data.endDate !== undefined ? { endDate: merged.endDate } : {}),
      ...(data.count !== undefined ? { count: data.count } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  })

  revalidatePath('/templates')
  return updated
}

export async function pauseRule(id: string, paused = true): Promise<RecurrenceRule> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.recurrenceRule.findUnique({ where: { id } })
  if (!existing) actionError('RULE_NOT_FOUND', `Regla ${id} no existe`)

  const updated = await prisma.recurrenceRule.update({
    where: { id },
    data: { active: !paused },
  })
  revalidatePath('/templates')
  return updated
}

export async function deleteRule(id: string): Promise<{ id: string }> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.recurrenceRule.findUnique({ where: { id } })
  if (!existing) actionError('RULE_NOT_FOUND', `Regla ${id} no existe`)

  await prisma.recurrenceRule.delete({ where: { id } })
  revalidatePath('/templates')
  return { id }
}

/**
 * Catch-up de una sola regla: genera tasks para todas las ocurrencias
 * pendientes desde `lastGeneratedAt` (o `startDate` si nunca corrió)
 * hasta `until` (default = ahora).
 *
 * Idempotente: la `@@unique([recurrenceRuleId, occurrenceDate])` en `Task`
 * evita duplicados si la function se ejecuta dos veces en paralelo.
 */
export async function generateOverdueOccurrences(
  ruleId: string,
  until: Date = new Date(),
): Promise<{ generated: number; skipped: number }> {
  if (!ruleId) actionError('INVALID_INPUT', 'ruleId requerido')

  const rule = await prisma.recurrenceRule.findUnique({
    where: { id: ruleId },
    include: { template: { select: { id: true, projectId: true } } },
  })
  if (!rule) actionError('RULE_NOT_FOUND', `Regla ${ruleId} no existe`)
  if (!rule.active) return { generated: 0, skipped: 0 }
  if (!rule.template.projectId) {
    // Templates globales no tienen projectId — el scheduler no sabe a qué
    // proyecto materializar. Edwin debe asignar projectId o configurar
    // override en una iteración futura.
    return { generated: 0, skipped: 0 }
  }

  const lower = rule.lastGeneratedAt ?? rule.startDate
  const occurrences = expandOccurrences(toRRule(rule), until).filter(
    (d) => d.getTime() > lower.getTime() || (rule.lastGeneratedAt == null && d.getTime() >= rule.startDate.getTime()),
  )

  let generated = 0
  let skipped = 0
  for (const occurrenceDate of occurrences) {
    const result = await instantiateFromTemplate({
      templateId: rule.template.id,
      projectId: rule.template.projectId,
      recurrenceRuleId: rule.id,
      occurrenceDate,
      overrides: { startDate: occurrenceDate.toISOString() },
    })
    if (result.alreadyExisted) skipped++
    else generated++
  }

  if (occurrences.length > 0) {
    const lastDate = occurrences[occurrences.length - 1]
    await prisma.recurrenceRule.update({
      where: { id: rule.id },
      data: { lastGeneratedAt: lastDate },
    })
  }

  revalidatePath('/list')
  return { generated, skipped }
}
