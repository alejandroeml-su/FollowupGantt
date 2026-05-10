/**
 * Wave P17-D · Métricas RED (Rate · Errors · Duration) in-memory.
 *
 * Diseño deliberadamente simple: un `Map<name, RedMetric>` por instancia
 * Node. No persistimos a Redis ni exportamos a Prometheus en esta wave —
 * el objetivo es tener visibilidad operativa básica sin agregar deps
 * pesadas (OpenTelemetry SDK, prom-client, etc).
 *
 * Trade-offs aceptados:
 *  - Reset implícito en cada cold-start de la lambda Vercel (acceptable
 *    para MVP — el dashboard refresca cada 30s y es suficiente para
 *    detectar picos en la ventana corta).
 *  - Sin agregación cross-instance (cada lambda ve sus propias métricas).
 *    Para la primera iteración de SLOs basta con observar percentiles
 *    locales — si el problema es global, lo veremos en todas las
 *    instancias por igual.
 *  - Ventana de muestreo limitada a `MAX_DURATION_SAMPLES` (100) por
 *    métrica para mantener O(1) en memoria. Suficiente para p50/p95/p99
 *    estables en un endpoint de tráfico moderado.
 *
 * Sin `any`: usamos tipos estrictos y `Math.floor` cuando indexamos.
 */
import 'server-only'
import * as Sentry from '@sentry/nextjs'

/** Tope de duraciones almacenadas por métrica. Más → mejor estabilidad. */
const MAX_DURATION_SAMPLES = 100

/**
 * SLO objetivos por defecto. Si una métrica los excede al snapshot,
 * emitimos un breadcrumb a Sentry (Sentry se encarga del agrupamiento).
 */
export const DEFAULT_SLO = {
  /** errorRate (%) que dispara un warning. */
  errorRatePct: 5,
  /** p95 (ms) que dispara un warning. */
  p95Ms: 1000,
} as const

/**
 * Estructura interna por métrica. Mutamos en sitio para evitar GC churn
 * en hot paths. `durationsMs` es un ring buffer — descartamos el más
 * antiguo cuando llegamos al cap.
 */
interface RedMetric {
  count: number
  errors: number
  durationsMs: number[]
}

/**
 * Snapshot serializable (lo que devuelve `snapshotMetrics`). Los
 * percentiles se calculan on-demand para no pagar el cost del sort en
 * cada `recordRed`.
 */
export interface RedMetricSnapshot {
  count: number
  errors: number
  errorRate: number
  p50: number
  p95: number
  p99: number
  /** Timestamp de la última muestra registrada (ms epoch) o null. */
  lastSampleAt: number | null
}

const metrics = new Map<string, RedMetric>()
const lastSampleAt = new Map<string, number>()

/**
 * Registra una observación. `durationMs` debe ser ≥ 0 — si es negativa
 * (clock skew, mock mal hecho), la clampeamos a 0 para no contaminar
 * percentiles.
 */
export function recordRed(
  name: string,
  durationMs: number,
  isError: boolean,
): void {
  if (!name) return
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : 0

  let m = metrics.get(name)
  if (!m) {
    m = { count: 0, errors: 0, durationsMs: [] }
    metrics.set(name, m)
  }
  m.count += 1
  if (isError) m.errors += 1

  // Ring buffer: si llegamos al cap, descartamos el más antiguo.
  if (m.durationsMs.length >= MAX_DURATION_SAMPLES) {
    m.durationsMs.shift()
  }
  m.durationsMs.push(safeDuration)
  lastSampleAt.set(name, Date.now())
}

/**
 * Calcula un percentil sobre un array (no-mutating). Implementación
 * "nearest-rank": para p%, devuelve el valor en posición ceil(p/100 * n).
 * Suficiente para uso operativo — no requerimos interpolación lineal.
 */
function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const rank = Math.ceil((p / 100) * sortedAsc.length)
  const idx = Math.min(Math.max(rank - 1, 0), sortedAsc.length - 1)
  return sortedAsc[idx] ?? 0
}

/**
 * Devuelve un snapshot read-only de todas las métricas registradas.
 * Los percentiles se calculan on-demand. El orden de las claves es
 * el de inserción (Map preserva insertion order).
 */
export function snapshotMetrics(): Record<string, RedMetricSnapshot> {
  const out: Record<string, RedMetricSnapshot> = {}
  for (const [name, m] of metrics.entries()) {
    const sorted = [...m.durationsMs].sort((a, b) => a - b)
    const errorRate = m.count > 0 ? (m.errors / m.count) * 100 : 0
    out[name] = {
      count: m.count,
      errors: m.errors,
      errorRate: Math.round(errorRate * 100) / 100, // 2 decimales
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      lastSampleAt: lastSampleAt.get(name) ?? null,
    }
  }
  return out
}

/**
 * Borra todas las métricas. Útil para tests y para el endpoint
 * `POST /api/internal/metrics/reset` (solo SUPER_ADMIN).
 */
export function resetMetrics(): void {
  metrics.clear()
  lastSampleAt.clear()
}

/**
 * Wrapper genérico para envolver server actions / handlers asíncronos
 * con métricas RED. Preserva la firma original (sin `any`) y re-lanza
 * la excepción para no alterar el contrato de la action.
 *
 * Uso:
 * ```ts
 * export async function createTask(input: CreateTaskInput) {
 *   return withMetrics('action.createTask', async () => {
 *     // ... cuerpo original ...
 *   })
 * }
 * ```
 */
export async function withMetrics<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    recordRed(name, Date.now() - start, false)
    return result
  } catch (err) {
    recordRed(name, Date.now() - start, true)
    throw err
  }
}

/**
 * Inspecciona el snapshot actual y emite breadcrumbs a Sentry para
 * cualquier métrica que viole el SLO. Es cheap (no envía evento, solo
 * breadcrumb) y se puede llamar desde el endpoint de snapshot o desde
 * un cron interno.
 *
 * Sólo evalúa métricas con `count >= minSampleCount` para evitar falsos
 * positivos sobre muestras minúsculas (e.g. 1 error de 1 sample → 100%).
 */
export function emitSloBreadcrumbs(
  snapshot: Record<string, RedMetricSnapshot>,
  opts: {
    errorRatePct?: number
    p95Ms?: number
    minSampleCount?: number
  } = {},
): { violations: number } {
  const errorRateBudget = opts.errorRatePct ?? DEFAULT_SLO.errorRatePct
  const p95Budget = opts.p95Ms ?? DEFAULT_SLO.p95Ms
  const minSamples = opts.minSampleCount ?? 10

  let violations = 0
  for (const [name, snap] of Object.entries(snapshot)) {
    if (snap.count < minSamples) continue
    const errorRateBad = snap.errorRate > errorRateBudget
    const latencyBad = snap.p95 > p95Budget
    if (!errorRateBad && !latencyBad) continue

    violations += 1
    Sentry.addBreadcrumb({
      category: 'slo.violation',
      level: 'warning',
      message: `SLO violation: ${name}`,
      data: {
        name,
        count: snap.count,
        errorRate: snap.errorRate,
        p95: snap.p95,
        p99: snap.p99,
        budgets: { errorRatePct: errorRateBudget, p95Ms: p95Budget },
        violatedErrorRate: errorRateBad,
        violatedLatency: latencyBad,
      },
    })
  }
  return { violations }
}

/**
 * Exposición para tests deterministas. NO importar desde producción.
 */
export const __internals = {
  MAX_DURATION_SAMPLES,
  percentile,
  metrics,
}
