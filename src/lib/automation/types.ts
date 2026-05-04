/**
 * Ola P5 · Equipo P5-5 — Tipos del motor de automatizaciones.
 *
 * Mantenemos los tipos en un módulo agnóstico de Prisma para que tests y
 * UI los importen sin arrastrar el cliente DB. La validación zod vive en
 * `validation.ts`; la ejecución en `engine.ts`.
 */

export const AUTOMATION_EVENTS = [
  'task.created',
  'status.changed',
  'form.submitted',
] as const

export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number]

export const CONDITION_OPERATORS = [
  '=',
  '!=',
  '>',
  '<',
  'contains',
] as const

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

export interface AutomationCondition {
  /** Path del campo del contexto: "task.status", "payload.email", etc. */
  field: string
  op: ConditionOperator
  value: string | number | boolean | null
}

export const ACTION_KINDS = [
  'createTask',
  'sendWebhook',
  'updateField',
  'assignUser',
] as const

export type ActionKind = (typeof ACTION_KINDS)[number]

export type AutomationAction =
  | {
      kind: 'createTask'
      projectId: string
      title: string
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
      assigneeId?: string
    }
  | {
      kind: 'sendWebhook'
      url: string
      method?: 'POST' | 'PUT' | 'GET'
      headers?: Record<string, string>
      body?: Record<string, unknown>
    }
  | {
      kind: 'updateField'
      taskId: string
      field: 'status' | 'priority' | 'progress'
      value: string | number
    }
  | {
      kind: 'assignUser'
      taskId: string
      userId: string
    }

export interface AutomationTrigger {
  event: AutomationEvent
  /** Filtro opcional sobre el evento (ej. `projectId: "abc"`). */
  match?: Record<string, string | number | boolean>
}

export interface AutomationRuleShape {
  id: string
  name: string
  isActive: boolean
  trigger: AutomationTrigger
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

export interface AutomationContext {
  /** Identificador estable del entity que disparó (ej. `task:<id>`). */
  triggeredBy: string
  /** Datos del evento, accesibles vía `field` path en condiciones. */
  data: Record<string, unknown>
}

export interface ActionResult {
  kind: ActionKind
  ok: boolean
  output?: unknown
  error?: string
}

export interface ExecutionResult {
  ruleId: string
  status: 'success' | 'failed' | 'skipped'
  actions: ActionResult[]
  skippedReason?: string
}
