import 'server-only'

/**
 * US-9.2 · Wave R5 — Catálogo de métricas automáticas para Gap Analysis.
 *
 * Cada métrica es una función pura `(projectId) => Promise<AutoMetricResult>`
 * que consulta Prisma y devuelve un valor numérico. El catálogo se invoca
 * SOLO al hacer "Refresh" explícito desde la UI (no en cada render) — los
 * resultados se persisten en `GapDimension.asIsValue` + `metricMetadata`.
 *
 * Convenciones:
 *   - Las métricas devuelven `null` cuando la muestra es insuficiente
 *     (ej. proyecto sin tareas AGILE para DoD). El caller decide si
 *     mostrar "—" o mantener el valor previo.
 *   - `metadata.sampleSize` permite mostrar la confianza en la UI
 *     ("3/3 tareas evaluadas" vs "12/120").
 *   - Las claves del catálogo son ESTABLES — se validan en server action
 *     antes de persistir como `GapDimension.metricKey`. Nunca renombrar
 *     una clave existente sin migración explícita.
 */

import prisma from '@/lib/prisma'
import { normalizeScrumAttributes } from '@/lib/scrum/types'
import { normalizePmiAttributes } from '@/lib/pmi/types'

// ───────────────────────── Resultado base ─────────────────────────

export type AutoMetricResult = {
  /** Valor numérico medido. `null` si la muestra es insuficiente. */
  value: number | null
  /** Unidad humana sugerida ("%", "tasks", "days"). */
  unit: string
  /** Tamaño de la muestra evaluada. */
  sampleSize: number
  /** Total candidato (denominador para porcentajes). */
  totalCandidates: number
  /** Fórmula corta para que el tooltip de la UI sea explicable. */
  formula: string
}

export type AutoMetricDef = {
  key: string
  label: string
  defaultToBe: number
  unit: string
  description: string
  /**
   * Pista al usuario sobre cómo interpretar el gap. La mayoría son
   * "higher-is-better" (verde cuando AS-IS ≥ TO-BE). `cycle_time_p50`
   * es la excepción: ahí TO-BE debería ser inferior al AS-IS para
   * representar mejora; lo marcamos como `lower-is-better` y la UI
   * invierte el TO-BE sugerido.
   */
  direction: 'higher-is-better' | 'lower-is-better'
  compute: (projectId: string) => Promise<AutoMetricResult>
}

// ───────────────────────── Helpers ─────────────────────────

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Number(((numerator / denominator) * 100).toFixed(2))
}

function medianFromSortedNumbers(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
  }
  return Number(sorted[mid].toFixed(2))
}

const MS_PER_DAY = 86_400_000

// ───────────────────────── Métricas ─────────────────────────

/**
 * % de tareas AGILE_STORY cuyo `scrumAttributes.dodChecklist` tiene
 * todos los items checked. Tareas sin checklist se cuentan como
 * "incompletas" (no excluidas) para no inflar artificialmente la
 * métrica al inicio del proyecto.
 */
async function computeDodCompletionRate(
  projectId: string,
): Promise<AutoMetricResult> {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      type: 'AGILE_STORY',
      archivedAt: null,
    },
    select: { id: true, scrumAttributes: true },
  })

  let withDod = 0
  let completedDod = 0
  for (const t of tasks) {
    const scrum = normalizeScrumAttributes(t.scrumAttributes)
    if (!scrum || scrum.dodChecklist.length === 0) continue
    withDod += 1
    const allChecked = scrum.dodChecklist.every((it) => it.checked)
    if (allChecked) completedDod += 1
  }

  return {
    value: pct(completedDod, tasks.length),
    unit: '%',
    sampleSize: withDod,
    totalCandidates: tasks.length,
    formula: 'tasks AGILE con DoD 100% checked ÷ total tasks AGILE',
  }
}

/**
 * % de tareas PMI_TASK con un `accountable` no vacío en
 * `pmiAttributes.raci`. Regla P-06 del validador exige exactamente 1
 * accountable; aquí medimos cuántas cumplen.
 */
async function computePmiRaciCoverage(
  projectId: string,
): Promise<AutoMetricResult> {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      type: 'PMI_TASK',
      archivedAt: null,
    },
    select: { id: true, pmiAttributes: true },
  })

  let withAccountable = 0
  for (const t of tasks) {
    const pmi = normalizePmiAttributes(t.pmiAttributes)
    if (pmi?.raci?.accountable) withAccountable += 1
  }

  return {
    value: pct(withAccountable, tasks.length),
    unit: '%',
    sampleSize: withAccountable,
    totalCandidates: tasks.length,
    formula: 'tasks PMI con RACI.accountable ÷ total tasks PMI',
  }
}

/**
 * Velocity promedio (story points) de los últimos 3 sprints cerrados
 * del proyecto. Sprint cerrado = `velocityActual` no null.
 */
async function computeVelocityAvg3Sprints(
  projectId: string,
): Promise<AutoMetricResult> {
  const sprints = await prisma.sprint.findMany({
    where: {
      projectId,
      velocityActual: { not: null },
    },
    orderBy: { endedAt: 'desc' },
    take: 3,
    select: { id: true, velocityActual: true },
  })

  const values = sprints
    .map((s) => s.velocityActual)
    .filter((v): v is number => typeof v === 'number')

  if (values.length === 0) {
    return {
      value: null,
      unit: 'pts',
      sampleSize: 0,
      totalCandidates: 0,
      formula: 'AVG(velocityActual) últimos 3 sprints cerrados',
    }
  }
  const avg = values.reduce((acc, v) => acc + v, 0) / values.length
  return {
    value: Number(avg.toFixed(2)),
    unit: 'pts',
    sampleSize: values.length,
    totalCandidates: values.length,
    formula: 'AVG(velocityActual) últimos 3 sprints cerrados',
  }
}

/**
 * % de tareas con `definitionComplete = true`. La columna la mantiene
 * el motor de validación (`task-validation/rules.ts`) y refleja que la
 * tarea cumple TODAS las reglas G/I/P/S sin errores.
 */
async function computeDefinitionCompleteRate(
  projectId: string,
): Promise<AutoMetricResult> {
  const [total, complete] = await Promise.all([
    prisma.task.count({ where: { projectId, archivedAt: null } }),
    prisma.task.count({
      where: { projectId, archivedAt: null, definitionComplete: true },
    }),
  ])

  return {
    value: pct(complete, total),
    unit: '%',
    sampleSize: complete,
    totalCandidates: total,
    formula: 'tasks con definitionComplete=true ÷ total tasks',
  }
}

/**
 * Ratio Risk Register coverage: # de Risks (OPEN/MITIGATING) por cada
 * 10 tasks. La práctica PMI sugiere ≥ 1 risk identificado por cada
 * 5-10 entregables; por eso normalizamos a "riesgos por 10 tareas".
 *
 * Devuelve `value=0` cuando hay tareas pero ningún risk (es una señal
 * válida, no insuficiencia de muestra).
 */
async function computeRiskRegisterCoverage(
  projectId: string,
): Promise<AutoMetricResult> {
  const [taskCount, riskCount] = await Promise.all([
    prisma.task.count({ where: { projectId, archivedAt: null } }),
    prisma.risk.count({
      where: { projectId, status: { in: ['OPEN', 'MITIGATING'] } },
    }),
  ])

  if (taskCount === 0) {
    return {
      value: null,
      unit: 'risks/10 tasks',
      sampleSize: 0,
      totalCandidates: 0,
      formula: '(# Risks OPEN+MITIGATING) × 10 ÷ total tasks',
    }
  }

  const value = Number(((riskCount * 10) / taskCount).toFixed(2))
  return {
    value,
    unit: 'risks/10 tasks',
    sampleSize: riskCount,
    totalCandidates: taskCount,
    formula: '(# Risks OPEN+MITIGATING) × 10 ÷ total tasks',
  }
}

/**
 * Mediana (P50) del cycle time en días — del primer IN_PROGRESS al
 * primer DONE — usando `TaskHistory`. Sólo considera tareas que
 * actualmente están en DONE (cierre observado).
 *
 * Cuando no hay tareas cerradas con historial suficiente, devuelve
 * `null` y la UI muestra "—".
 */
async function computeCycleTimeP50(
  projectId: string,
): Promise<AutoMetricResult> {
  // Tareas actualmente en DONE del proyecto.
  const tasks = await prisma.task.findMany({
    where: { projectId, archivedAt: null, status: 'DONE' },
    select: {
      id: true,
      history: {
        select: { field: true, newValue: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  const cycleDays: number[] = []
  for (const t of tasks) {
    let inProgressAt: Date | null = null
    let doneAt: Date | null = null
    for (const h of t.history) {
      if (h.field !== 'status') continue
      if (h.newValue === 'IN_PROGRESS' && !inProgressAt) {
        inProgressAt = h.createdAt
      } else if (h.newValue === 'DONE' && inProgressAt && !doneAt) {
        doneAt = h.createdAt
        break
      }
    }
    if (inProgressAt && doneAt) {
      const days = (doneAt.getTime() - inProgressAt.getTime()) / MS_PER_DAY
      if (days >= 0) cycleDays.push(days)
    }
  }

  const median = medianFromSortedNumbers(cycleDays)
  return {
    value: median,
    unit: 'days',
    sampleSize: cycleDays.length,
    totalCandidates: tasks.length,
    formula: 'P50( días entre IN_PROGRESS y DONE ) por TaskHistory',
  }
}

// ───────────────────────── Catálogo público ─────────────────────────

/**
 * Catálogo central. Sólo claves listadas aquí pueden persistirse en
 * `GapDimension.metricKey`. Para añadir una nueva métrica:
 *   1. Implementar función `compute*` arriba.
 *   2. Registrarla aquí con `defaultToBe` razonable.
 *   3. Añadir test en `tests/unit/gap-analysis-auto-metrics.test.ts`.
 */
export const AUTO_METRICS: AutoMetricDef[] = [
  {
    key: 'dod_completion_rate',
    label: 'Cobertura DoD (Definition of Done)',
    defaultToBe: 90,
    unit: '%',
    description:
      '% de historias AGILE con todos los items del DoD checklist marcados.',
    direction: 'higher-is-better',
    compute: computeDodCompletionRate,
  },
  {
    key: 'pmi_raci_coverage',
    label: 'Cobertura RACI (PMI)',
    defaultToBe: 100,
    unit: '%',
    description:
      '% de tareas PMI con un Accountable definido en la matriz RACI.',
    direction: 'higher-is-better',
    compute: computePmiRaciCoverage,
  },
  {
    key: 'velocity_avg_3sprints',
    label: 'Velocity promedio (3 sprints)',
    defaultToBe: 30,
    unit: 'pts',
    description:
      'Promedio de story points entregados en los últimos 3 sprints cerrados.',
    direction: 'higher-is-better',
    compute: computeVelocityAvg3Sprints,
  },
  {
    key: 'definition_complete_rate',
    label: 'Definición completa (Reglas G/I/P/S)',
    defaultToBe: 95,
    unit: '%',
    description:
      '% de tareas que cumplen todas las reglas de validación sin errores.',
    direction: 'higher-is-better',
    compute: computeDefinitionCompleteRate,
  },
  {
    key: 'risk_register_coverage',
    label: 'Cobertura del Risk Register',
    defaultToBe: 2,
    unit: 'risks/10 tasks',
    description:
      'Riesgos abiertos o mitigando por cada 10 tareas (benchmark PMI 1-2).',
    direction: 'higher-is-better',
    compute: computeRiskRegisterCoverage,
  },
  {
    key: 'cycle_time_p50',
    label: 'Cycle Time mediano (días)',
    defaultToBe: 3,
    unit: 'days',
    description:
      'Mediana de días entre el primer paso a IN_PROGRESS y el primer paso a DONE.',
    direction: 'lower-is-better',
    compute: computeCycleTimeP50,
  },
]

export const AUTO_METRIC_KEYS = AUTO_METRICS.map((m) => m.key)

/**
 * Localiza una métrica por su clave. Devuelve `undefined` si la clave
 * no está en el catálogo — el caller debe propagar `INVALID_METRIC_KEY`.
 */
export function findAutoMetric(key: string): AutoMetricDef | undefined {
  return AUTO_METRICS.find((m) => m.key === key)
}
