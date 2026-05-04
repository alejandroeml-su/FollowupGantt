/**
 * Ola P5 · Equipo P5-5 — Motor "if-this-then-that".
 *
 * Funciones puras (con dependencias inyectadas) para:
 *   - `matchesTrigger`: comparar el evento entrante con `rule.trigger`.
 *   - `getFieldValue`: resolver un path tipo "task.status" en `context.data`.
 *   - `evaluateCondition` / `evaluateAllConditions`: evaluación AND.
 *   - `runRuleActions`: ejecutar acciones secuencialmente con anti-loop.
 *   - `runAutomations`: orquesta todo: lista reglas → match → eval → exec.
 *
 * Anti-loop:
 *   - Máximo 5 acciones por ejecución (D-FA-3 — viene del schema).
 *   - El caller declara un `currentRuleId?` para evitar re-disparar la
 *     misma regla durante la cadena (cuando una acción produce un evento).
 */

import type {
  AutomationAction,
  AutomationContext,
  AutomationCondition,
  AutomationEvent,
  AutomationRuleShape,
  AutomationTrigger,
  ActionResult,
  ConditionOperator,
  ExecutionResult,
} from './types'

export const MAX_ACTIONS_PER_EXECUTION = 5

// ─────────────────────────── Trigger matching ───────────────────────────

export function matchesTrigger(
  trigger: AutomationTrigger,
  event: AutomationEvent,
  context: AutomationContext,
): boolean {
  if (trigger.event !== event) return false
  if (!trigger.match) return true
  for (const [k, v] of Object.entries(trigger.match)) {
    if (getFieldValue(context.data, k) !== v) return false
  }
  return true
}

// ─────────────────────────── Field resolution ───────────────────────────

export function getFieldValue(
  data: Record<string, unknown>,
  path: string,
): unknown {
  if (!path) return undefined
  const parts = path.split('.')
  let cur: unknown = data
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

// ─────────────────────────── Conditions ───────────────────────────

function compareValues(
  op: ConditionOperator,
  actual: unknown,
  expected: string | number | boolean | null,
): boolean {
  switch (op) {
    case '=':
      // Coerción suave para que payload string '5' === 5 expected.
      if (typeof actual === 'number' && typeof expected === 'string') {
        return String(actual) === expected
      }
      if (typeof actual === 'string' && typeof expected === 'number') {
        return actual === String(expected)
      }
      return actual === expected
    case '!=':
      return !compareValues('=', actual, expected)
    case '>': {
      const a = Number(actual)
      const b = Number(expected)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      return a > b
    }
    case '<': {
      const a = Number(actual)
      const b = Number(expected)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      return a < b
    }
    case 'contains': {
      if (actual === null || actual === undefined) return false
      const haystack = String(actual).toLowerCase()
      const needle = String(expected ?? '').toLowerCase()
      if (needle === '') return false
      return haystack.includes(needle)
    }
    default:
      return false
  }
}

export function evaluateCondition(
  condition: AutomationCondition,
  context: AutomationContext,
): boolean {
  const actual = getFieldValue(context.data, condition.field)
  return compareValues(condition.op, actual, condition.value)
}

export function evaluateAllConditions(
  conditions: AutomationCondition[],
  context: AutomationContext,
): boolean {
  if (conditions.length === 0) return true
  return conditions.every((c) => evaluateCondition(c, context))
}

// ─────────────────────────── Action execution ───────────────────────────

/**
 * Adapter que el caller debe inyectar — el motor no llama Prisma ni fetch
 * directamente para que sea testeable y reutilizable en edge / cron.
 */
export interface ActionAdapter {
  createTask: (
    payload: Extract<AutomationAction, { kind: 'createTask' }>,
  ) => Promise<{ taskId: string }>
  sendWebhook: (
    payload: Extract<AutomationAction, { kind: 'sendWebhook' }>,
  ) => Promise<{ status: number }>
  updateField: (
    payload: Extract<AutomationAction, { kind: 'updateField' }>,
  ) => Promise<{ taskId: string; field: string }>
  assignUser: (
    payload: Extract<AutomationAction, { kind: 'assignUser' }>,
  ) => Promise<{ taskId: string; userId: string }>
}

export async function runRuleActions(
  actions: AutomationAction[],
  adapter: ActionAdapter,
): Promise<ActionResult[]> {
  const limited = actions.slice(0, MAX_ACTIONS_PER_EXECUTION)
  const results: ActionResult[] = []
  for (const action of limited) {
    try {
      switch (action.kind) {
        case 'createTask': {
          const out = await adapter.createTask(action)
          results.push({ kind: 'createTask', ok: true, output: out })
          break
        }
        case 'sendWebhook': {
          const out = await adapter.sendWebhook(action)
          results.push({ kind: 'sendWebhook', ok: true, output: out })
          break
        }
        case 'updateField': {
          const out = await adapter.updateField(action)
          results.push({ kind: 'updateField', ok: true, output: out })
          break
        }
        case 'assignUser': {
          const out = await adapter.assignUser(action)
          results.push({ kind: 'assignUser', ok: true, output: out })
          break
        }
      }
    } catch (err) {
      results.push({
        kind: action.kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      // Detener cadena al primer fallo: las acciones siguientes podrían
      // depender del estado producido por la fallida.
      break
    }
  }
  return results
}

// ─────────────────────────── Orquestador ───────────────────────────

export interface RunAutomationsDeps {
  /** Devuelve TODAS las reglas activas. El motor filtra por trigger en memoria. */
  loadActiveRules: () => Promise<AutomationRuleShape[]>
  adapter: ActionAdapter
  /** Persiste el resultado de una ejecución (best-effort, no debe lanzar). */
  recordExecution: (
    ruleId: string,
    triggeredBy: string,
    status: 'success' | 'failed' | 'skipped',
    result: { actions: ActionResult[]; skippedReason?: string },
  ) => Promise<void>
  /**
   * ID de la regla "padre" en la cadena, para anti-loop. Si lo recibimos,
   * NO disparamos esa misma regla aunque su trigger matchee.
   */
  currentRuleId?: string
}

export async function runAutomations(
  event: AutomationEvent,
  context: AutomationContext,
  deps: RunAutomationsDeps,
): Promise<ExecutionResult[]> {
  const rules = await deps.loadActiveRules()
  const out: ExecutionResult[] = []

  for (const rule of rules) {
    if (!rule.isActive) continue
    if (deps.currentRuleId && deps.currentRuleId === rule.id) {
      // Anti-loop: misma regla disparándose a sí misma → saltar.
      out.push({
        ruleId: rule.id,
        status: 'skipped',
        actions: [],
        skippedReason: 'self-trigger blocked',
      })
      continue
    }
    if (!matchesTrigger(rule.trigger, event, context)) continue
    if (!evaluateAllConditions(rule.conditions, context)) {
      out.push({
        ruleId: rule.id,
        status: 'skipped',
        actions: [],
        skippedReason: 'conditions not met',
      })
      await deps.recordExecution(rule.id, context.triggeredBy, 'skipped', {
        actions: [],
        skippedReason: 'conditions not met',
      })
      continue
    }

    const actionResults = await runRuleActions(rule.actions, deps.adapter)
    const allOk = actionResults.length > 0 && actionResults.every((r) => r.ok)
    const status: 'success' | 'failed' = allOk ? 'success' : 'failed'

    out.push({ ruleId: rule.id, status, actions: actionResults })
    await deps.recordExecution(rule.id, context.triggeredBy, status, {
      actions: actionResults,
    })
  }

  return out
}
