/**
 * Ola P7 · Equipo P7-3 · Baseline diff summary
 *
 * Compara una baseline persistida (`BaselineSnapshot`) contra el
 * snapshot actual del proyecto y resume los cambios en lenguaje natural.
 *
 * Diff cubierto:
 *   - Tareas que cambiaron de fecha de fin (movidas hacia adelante).
 *   - Tareas que cambiaron de progress.
 *   - Tareas que cambiaron de costo (ACWP).
 *   - Tareas nuevas (no estaban en baseline).
 *   - Tareas faltantes (estaban en baseline, no en current).
 *
 * El diff es PURO (no toca Prisma): la server action carga ambos
 * snapshots y los pasa.
 */

import 'server-only'

import {
  buildUserMessage,
  callLLM,
  parseLLMMarkdown,
  withFallback,
  SYSTEM_PROMPT_PMO,
  type Narrative,
} from './prompts'
import type { BaselineTask } from '@/lib/scheduling/baseline-snapshot'

/**
 * Tarea actual mínima necesaria para el diff. Compatible con `BaselineTask`
 * (mismas propiedades) pero relajada: el current puede venir de Prisma sin
 * pasar por el zod schema de baseline.
 */
export type CurrentSnapshotTask = {
  id: string
  title: string
  plannedEnd: string | null
  plannedValue: number | null
  actualCost: number | null
  progress: number | null
  status: string
}

export type BaselineDiffInput = {
  projectName: string
  baseline: {
    capturedAt: string
    label: string | null
    version: number
    tasks: ReadonlyArray<BaselineTask>
  }
  current: {
    asOf: string
    tasks: ReadonlyArray<CurrentSnapshotTask>
  }
}

export type BaselineDiffMetrics = {
  totalBaseline: number
  totalCurrent: number
  added: Array<{ id: string; title: string }>
  removed: Array<{ id: string; title: string }>
  delayed: Array<{
    id: string
    title: string
    daysShifted: number
  }>
  progressDelta: Array<{
    id: string
    title: string
    deltaPercent: number
  }>
  costDelta: Array<{
    id: string
    title: string
    baselineAC: number
    currentAC: number
    deltaAbsolute: number
    deltaPercent: number | null
  }>
  budgetVariancePercent: number | null
  totalBaselineAC: number
  totalCurrentAC: number
}

const MS_PER_DAY = 86_400_000

function diffDaysISO(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return 0
  return Math.round((db - da) / MS_PER_DAY)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Computa el diff puro. Determinístico. No depende de `now`.
 */
export function computeBaselineDiff(input: BaselineDiffInput): BaselineDiffMetrics {
  const baseMap = new Map<string, BaselineTask>()
  for (const t of input.baseline.tasks) baseMap.set(t.id, t)
  const curMap = new Map<string, CurrentSnapshotTask>()
  for (const t of input.current.tasks) curMap.set(t.id, t)

  const added: BaselineDiffMetrics['added'] = []
  const removed: BaselineDiffMetrics['removed'] = []
  const delayed: BaselineDiffMetrics['delayed'] = []
  const progressDelta: BaselineDiffMetrics['progressDelta'] = []
  const costDelta: BaselineDiffMetrics['costDelta'] = []

  let totalBaselineAC = 0
  let totalCurrentAC = 0

  for (const [id, base] of baseMap.entries()) {
    totalBaselineAC += base.actualCost ?? 0
    const cur = curMap.get(id)
    if (!cur) {
      removed.push({ id, title: base.title })
      continue
    }
    const days = diffDaysISO(base.plannedEnd, cur.plannedEnd)
    if (days > 0) {
      // movido a futuro = atrasado
      delayed.push({ id, title: cur.title, daysShifted: days })
    }
    const baseProg = base.progress ?? 0
    const curProg = cur.progress ?? 0
    const deltaProg = curProg - baseProg
    if (Math.abs(deltaProg) >= 5) {
      progressDelta.push({
        id,
        title: cur.title,
        deltaPercent: deltaProg,
      })
    }
    const baseAC = base.actualCost ?? 0
    const curAC = cur.actualCost ?? 0
    const deltaAbs = curAC - baseAC
    if (Math.abs(deltaAbs) > 0.01) {
      const deltaPct = baseAC > 0 ? (deltaAbs / baseAC) * 100 : null
      costDelta.push({
        id,
        title: cur.title,
        baselineAC: round2(baseAC),
        currentAC: round2(curAC),
        deltaAbsolute: round2(deltaAbs),
        deltaPercent: deltaPct != null ? round2(deltaPct) : null,
      })
    }
  }

  for (const [id, cur] of curMap.entries()) {
    totalCurrentAC += cur.actualCost ?? 0
    if (!baseMap.has(id)) {
      added.push({ id, title: cur.title })
    }
  }

  // Orden estable: mayor impacto primero
  delayed.sort((a, b) => b.daysShifted - a.daysShifted)
  progressDelta.sort(
    (a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent),
  )
  costDelta.sort(
    (a, b) => Math.abs(b.deltaAbsolute) - Math.abs(a.deltaAbsolute),
  )

  const budgetVariancePercent =
    totalBaselineAC > 0
      ? round2(((totalCurrentAC - totalBaselineAC) / totalBaselineAC) * 100)
      : null

  return {
    totalBaseline: baseMap.size,
    totalCurrent: curMap.size,
    added,
    removed,
    delayed,
    progressDelta,
    costDelta,
    budgetVariancePercent,
    totalBaselineAC: round2(totalBaselineAC),
    totalCurrentAC: round2(totalCurrentAC),
  }
}

const DIFF_INSTRUCTION = `Resume las diferencias entre la baseline y el snapshot actual del proyecto. Estructura obligatoria:

# <titular: cuántos cambios desde baseline>

## Resumen
Un párrafo (2-3 frases) con totales: cuántas tareas atrasadas, presupuesto, cambios netos.

## Atrasos vs baseline
Bullets: tareas con plannedEnd movido a futuro (top 5).

## Progreso vs baseline
Bullets: tareas con progreso muy distinto al esperado (top 5). Indica si avanzaron más o menos.

## Costos vs baseline
Bullets: tareas con costo mayor o menor que el baseline (top 5).

## Cambios estructurales
Bullets cortos: tareas añadidas/removidas vs baseline.

## Recomendaciones
1-3 bullets accionables.`

function compactDiff(input: BaselineDiffInput, metrics: BaselineDiffMetrics) {
  return {
    project: input.projectName,
    baseline: {
      version: input.baseline.version,
      capturedAt: input.baseline.capturedAt,
      label: input.baseline.label,
    },
    asOf: input.current.asOf,
    metrics: {
      totalBaseline: metrics.totalBaseline,
      totalCurrent: metrics.totalCurrent,
      delayedCount: metrics.delayed.length,
      progressChangedCount: metrics.progressDelta.length,
      costChangedCount: metrics.costDelta.length,
      addedCount: metrics.added.length,
      removedCount: metrics.removed.length,
      budgetVariancePercent: metrics.budgetVariancePercent,
    },
    delayedTopFive: metrics.delayed.slice(0, 5),
    progressTopFive: metrics.progressDelta.slice(0, 5),
    costTopFive: metrics.costDelta.slice(0, 5),
    addedTopFive: metrics.added.slice(0, 5),
    removedTopFive: metrics.removed.slice(0, 5),
  }
}

// ─────────────────────────── Heurística ───────────────────────────────

export function generateBaselineDiffSummaryHeuristic(
  input: BaselineDiffInput,
  metrics: BaselineDiffMetrics,
  now: Date = new Date(),
): Narrative {
  const labelPart = input.baseline.label
    ? `"${input.baseline.label}"`
    : `v.${input.baseline.version}`
  const baseDate = new Date(input.baseline.capturedAt).toLocaleDateString(
    'es-MX',
    { day: '2-digit', month: 'short', year: 'numeric' },
  )
  const headline =
    metrics.delayed.length === 0 && metrics.progressDelta.length === 0
      ? `${input.projectName}: sin cambios significativos vs baseline ${labelPart}`
      : `${input.projectName}: ${metrics.delayed.length} atraso(s), ${metrics.costDelta.length} ajuste(s) de costo vs ${labelPart}`

  const lines: string[] = []
  lines.push(`# ${headline}`)
  lines.push('')

  // Resumen
  lines.push('## Resumen')
  const budgetTxt =
    metrics.budgetVariancePercent != null
      ? metrics.budgetVariancePercent > 0
        ? `${metrics.budgetVariancePercent.toFixed(1)}% sobre presupuesto`
        : `${Math.abs(metrics.budgetVariancePercent).toFixed(1)}% bajo presupuesto`
      : 'sin datos de presupuesto'
  lines.push(
    `Vs baseline del **${baseDate}** ${labelPart}: ${metrics.delayed.length} tarea(s) atrasada(s), ${metrics.progressDelta.length} con cambio de progreso, ${metrics.costDelta.length} con cambio de costo. Presupuesto: ${budgetTxt}.`,
  )
  lines.push('')

  // Atrasos
  lines.push('## Atrasos vs baseline')
  if (metrics.delayed.length === 0) {
    lines.push('- Ninguna tarea movida a futuro respecto a la baseline.')
  } else {
    for (const t of metrics.delayed.slice(0, 5)) {
      lines.push(`- **${t.title}** — ${t.daysShifted} día(s) movido a futuro.`)
    }
  }
  lines.push('')

  // Progreso
  lines.push('## Progreso vs baseline')
  if (metrics.progressDelta.length === 0) {
    lines.push('- Sin cambios significativos de progreso (>=5%).')
  } else {
    for (const t of metrics.progressDelta.slice(0, 5)) {
      const dir = t.deltaPercent > 0 ? 'avance' : 'retroceso'
      lines.push(
        `- **${t.title}** — ${dir} de ${Math.abs(t.deltaPercent)}pp.`,
      )
    }
  }
  lines.push('')

  // Costos
  lines.push('## Costos vs baseline')
  if (metrics.costDelta.length === 0) {
    lines.push('- Sin cambios de costo respecto a la baseline.')
  } else {
    for (const t of metrics.costDelta.slice(0, 5)) {
      const sign = t.deltaAbsolute > 0 ? '+' : ''
      const pctTxt =
        t.deltaPercent != null ? ` (${sign}${t.deltaPercent.toFixed(1)}%)` : ''
      lines.push(
        `- **${t.title}** — ${sign}${t.deltaAbsolute.toFixed(2)} sobre costo baseline${pctTxt}.`,
      )
    }
  }
  lines.push('')

  // Estructurales
  lines.push('## Cambios estructurales')
  if (metrics.added.length === 0 && metrics.removed.length === 0) {
    lines.push('- Sin tareas añadidas ni removidas vs baseline.')
  } else {
    if (metrics.added.length > 0) {
      lines.push(
        `- ${metrics.added.length} tarea(s) añadida(s)${metrics.added.length <= 5 ? ': ' + metrics.added.map((a) => a.title).join(', ') : ''}.`,
      )
    }
    if (metrics.removed.length > 0) {
      lines.push(
        `- ${metrics.removed.length} tarea(s) removida(s)${metrics.removed.length <= 5 ? ': ' + metrics.removed.map((a) => a.title).join(', ') : ''}.`,
      )
    }
  }
  lines.push('')

  // Recomendaciones
  const recommendations: string[] = []
  if (metrics.delayed.length >= 3) {
    recommendations.push(
      'Convocar revisión de cronograma con responsables de tareas atrasadas.',
    )
  }
  if (
    metrics.budgetVariancePercent != null &&
    metrics.budgetVariancePercent > 5
  ) {
    recommendations.push(
      'Revisar control de costos: presupuesto sobre baseline.',
    )
  }
  if (metrics.added.length >= 5) {
    recommendations.push(
      'Validar alcance: hubo crecimiento de tareas vs baseline (scope creep).',
    )
  }
  if (recommendations.length === 0) {
    recommendations.push('Mantener seguimiento; baseline alineada con realidad.')
  }
  lines.push('## Recomendaciones')
  for (const r of recommendations) lines.push(`- ${r}`)

  const keyPoints: string[] = [
    `${metrics.delayed.length} atraso(s)`,
    `${metrics.costDelta.length} ajuste(s) de costo`,
    metrics.budgetVariancePercent != null
      ? `${metrics.budgetVariancePercent > 0 ? '+' : ''}${metrics.budgetVariancePercent.toFixed(1)}% vs presupuesto`
      : 'sin datos de presupuesto',
  ]

  return {
    headline,
    markdown: lines.join('\n'),
    keyPoints,
    recommendations,
    source: 'heuristic',
    generatedAt: now.toISOString(),
  }
}

// ─────────────────────────── LLM (con fallback) ───────────────────────

export async function generateBaselineDiffSummary(
  input: BaselineDiffInput,
  now: Date = new Date(),
): Promise<Narrative> {
  const metrics = computeBaselineDiff(input)
  const fallback = () =>
    generateBaselineDiffSummaryHeuristic(input, metrics, now)
  const compact = compactDiff(input, metrics)

  return withFallback(async () => {
    const userMessage = buildUserMessage({
      instruction: DIFF_INSTRUCTION,
      data: compact,
      outputHint:
        'Devuelve markdown. NO inventes tareas o métricas que no estén en los datos.',
    })
    const raw = await callLLM({
      systemPrompt: SYSTEM_PROMPT_PMO,
      userMessage,
      maxTokens: 800,
    })
    const parsed = parseLLMMarkdown(raw)
    return {
      headline: parsed.headline,
      markdown: parsed.markdown,
      keyPoints: parsed.keyPoints,
      recommendations: parsed.recommendations,
      source: 'llm' as const,
      generatedAt: now.toISOString(),
    }
  }, fallback)
}
