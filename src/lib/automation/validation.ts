/**
 * Ola P5 · Equipo P5-5 — Validación zod para AutomationRule.
 *
 * Convierte el JSON libre persistido en BD en estructuras tipadas. El
 * server action valida con `parseRuleShape` antes de persistir; el motor
 * lo vuelve a parsear al ejecutar para tolerar reglas viejas (forward-
 * compatible).
 */

import { z } from 'zod'
import {
  AUTOMATION_EVENTS,
  CONDITION_OPERATORS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRuleShape,
  type AutomationTrigger,
} from './types'

export const triggerSchema = z.object({
  event: z.enum(AUTOMATION_EVENTS),
  match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

export const conditionSchema = z.object({
  field: z.string().min(1).max(120),
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('createTask'),
    projectId: z.string().min(1),
    title: z.string().min(1).max(200),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    assigneeId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('sendWebhook'),
    url: z.string().url(),
    method: z.enum(['POST', 'PUT', 'GET']).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('updateField'),
    taskId: z.string().min(1),
    field: z.enum(['status', 'priority', 'progress']),
    value: z.union([z.string(), z.number()]),
  }),
  z.object({
    kind: z.literal('assignUser'),
    taskId: z.string().min(1),
    userId: z.string().min(1),
  }),
])

export const ruleShapeSchema = z.object({
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(5).default([]),
})

export type RuleShapeInput = z.input<typeof ruleShapeSchema>

/**
 * Valida un shape de regla. Lanza con mensaje legible.
 */
export function parseRuleShape(input: unknown): {
  trigger: AutomationTrigger
  conditions: AutomationCondition[]
  actions: AutomationAction[]
} {
  const parsed = ruleShapeSchema.parse(input)
  return {
    trigger: parsed.trigger as AutomationTrigger,
    conditions: parsed.conditions as AutomationCondition[],
    actions: parsed.actions as AutomationAction[],
  }
}

/**
 * Variante segura. Devuelve la regla parseada o `null` si el shape persistido
 * está corrupto (versiones viejas, copy-paste manual). El motor usa esta
 * versión para "skip" reglas inválidas en lugar de explotar todo.
 */
export function safeParseRulePersisted(raw: {
  id: string
  name: string
  isActive: boolean
  trigger: unknown
  conditions: unknown
  actions: unknown
}): AutomationRuleShape | null {
  const t = triggerSchema.safeParse(raw.trigger)
  if (!t.success) return null
  const c = z.array(conditionSchema).safeParse(raw.conditions ?? [])
  if (!c.success) return null
  const a = z.array(actionSchema).safeParse(raw.actions ?? [])
  if (!a.success || a.data.length === 0) return null
  return {
    id: raw.id,
    name: raw.name,
    isActive: raw.isActive,
    trigger: t.data as AutomationTrigger,
    conditions: c.data as AutomationCondition[],
    actions: a.data as AutomationAction[],
  }
}
