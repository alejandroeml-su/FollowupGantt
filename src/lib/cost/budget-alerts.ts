/**
 * Ola P8 · Equipo P8-3 · Cost Management — alertas de presupuesto.
 *
 * Detecta budget overruns y dispatcha webhooks. La función principal
 * `detectBudgetAlerts` es PURA (no toca BD ni la red): recibe los
 * snapshots y devuelve qué alertas disparar. La función `dispatchBudgetAlerts`
 * es side-effecting y delega al webhook dispatcher real.
 *
 * Eventos webhook emitidos (extensión del catálogo P4-2):
 *   - `budget.threshold_breached`: utilization >= threshold (0.75/0.9/1.0).
 *   - `budget.overrun`: utilization > 1.0 (sobregasto absoluto).
 *
 * Decisión D-ALERT-1: el caller (server action) consulta los snapshots con
 *   `buildBudgetSnapshots` y los pasa a `detectBudgetAlerts`. NO
 *   memorizamos qué alertas ya se enviaron — disparamos cada vez que el
 *   detector se invoca. Idempotencia es responsabilidad del receptor del
 *   webhook (revisar `triggeredAt` y deduplicar). En P8-4 se introducirá
 *   un cache `BudgetAlertLog` para evitar spam.
 *
 * Decisión D-ALERT-2: thresholds son configurables vía argumento; default
 *   `DEFAULT_BUDGET_ALERT_THRESHOLDS` (`expense-types.ts`). Si se pasa
 *   array vacío, no se dispara nada (modo "silencio total").
 */

import type { BudgetAlertEvent, BudgetSnapshot } from './expense-types'
import { DEFAULT_BUDGET_ALERT_THRESHOLDS } from './expense-types'

export interface DetectAlertsInput {
  /** Snapshots de presupuesto (project, phases, sprints). */
  snapshots: readonly BudgetSnapshot[]
  /** Mapa scopeId → name para enriquecer el evento. */
  names: Readonly<Record<string, string>>
  /** Thresholds en orden DESC (1.0, 0.9, 0.75). Default = constante. */
  thresholds?: readonly number[]
  /** Timestamp ISO inyectable para tests deterministas. */
  now?: Date
}

/**
 * Devuelve los eventos a emitir. Para cada snapshot escoge el threshold
 * MÁS ALTO que se haya cruzado (1.0 > 0.9 > 0.75). Si ninguno aplica,
 * no emite evento para ese scope.
 */
export function detectBudgetAlerts(input: DetectAlertsInput): BudgetAlertEvent[] {
  const thresholds = (input.thresholds ?? DEFAULT_BUDGET_ALERT_THRESHOLDS)
    .filter((t) => Number.isFinite(t) && t > 0)
    .slice()
    .sort((a, b) => b - a)

  if (thresholds.length === 0) return []

  const now = (input.now ?? new Date()).toISOString()
  const events: BudgetAlertEvent[] = []

  for (const snap of input.snapshots) {
    if (!Number.isFinite(snap.utilization)) continue
    if (snap.budgetUsd <= 0) continue // sin baseline no hay alerta
    const matched = thresholds.find((t) => snap.utilization >= t)
    if (matched === undefined) continue

    events.push({
      scopeId: snap.scopeId,
      scopeType: snap.scopeType,
      scopeName: input.names[snap.scopeId] ?? snap.scopeId,
      budgetUsd: snap.budgetUsd,
      actualUsd: snap.actualUsd,
      utilization: round4(snap.utilization),
      threshold: matched,
      triggeredAt: now,
    })
  }

  return events
}

/**
 * Dispatcher real. Acepta el dispatcher inyectado para que tests lo
 * sustituyan sin necesitar mockear el módulo de webhooks completo.
 *
 * Eventos:
 *   - utilization > 1.0 → `budget.overrun`
 *   - utilization >= threshold (0.75/0.9/1.0) → `budget.threshold_breached`
 */
export async function dispatchBudgetAlerts(
  events: readonly BudgetAlertEvent[],
  dispatcher: (eventType: string, data: unknown) => Promise<void>,
): Promise<{ dispatched: number; failed: number }> {
  let dispatched = 0
  let failed = 0
  for (const ev of events) {
    const eventType = ev.utilization > 1.0
      ? 'budget.overrun'
      : 'budget.threshold_breached'
    try {
      await dispatcher(eventType, ev)
      dispatched += 1
    } catch (err) {
      failed += 1
      // Best-effort: log y continúa (paridad con webhooks/dispatcher).
      console.warn(
        `[budget-alerts] dispatch falló para ${ev.scopeType}:${ev.scopeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
  return { dispatched, failed }
}

/**
 * Construye snapshots a partir de presupuestos y gastos agregados. Función
 * pura — el caller (server action) hace los queries y pasa los datos.
 *
 * @param scopes lista de presupuestos por scope.
 * @param actualByScope mapa scopeId → actualUsd (sum de Expense.amountUsd).
 * @param rateLookup función opcional para convertir budget→USD si la
 *                   moneda no es USD. Si NULL y la moneda no es USD, asume
 *                   tasa 1:1 (fallback conservador, marca un warn).
 */
export interface ScopeBudgetInput {
  scopeId: string
  scopeType: 'project' | 'phase' | 'sprint'
  budget: number | null
  currency: string | null
}

export function buildBudgetSnapshots(
  scopes: readonly ScopeBudgetInput[],
  actualByScope: Readonly<Record<string, number>>,
  budgetUsdByScope: Readonly<Record<string, number>>,
): BudgetSnapshot[] {
  const out: BudgetSnapshot[] = []
  for (const s of scopes) {
    if (s.budget === null || s.budget <= 0) continue
    const currency = (s.currency ?? 'USD').toUpperCase()
    const budgetUsd = budgetUsdByScope[s.scopeId] ?? (currency === 'USD' ? s.budget : 0)
    const actualUsd = actualByScope[s.scopeId] ?? 0
    const utilization = budgetUsd > 0 ? actualUsd / budgetUsd : 0
    out.push({
      scopeId: s.scopeId,
      scopeType: s.scopeType,
      budget: s.budget,
      currency,
      budgetUsd: round2(budgetUsd),
      actualUsd: round2(actualUsd),
      utilization: round4(utilization),
    })
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
