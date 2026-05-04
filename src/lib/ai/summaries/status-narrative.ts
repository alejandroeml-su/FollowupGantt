/**
 * Ola P7 · Equipo P7-3 · Status narrative
 *
 * Genera una narrativa ejecutiva de 3-5 párrafos a partir del
 * `StatusReportData` ya calculado por P5-3 (`getStatusReport`).
 *
 * Output:
 *   - headline                  → titular corto (proyecto + estado)
 *   - paragraphs                → contexto, logros, alertas, próximos pasos
 *   - keyPoints                 → 3-5 highlights tipo bullet
 *   - recommendations           → 1-3 acciones sugeridas
 *   - markdown                  → versión renderizable directa
 *   - source                    → 'llm' | 'heuristic'
 *
 * El módulo es PURO: no toca Prisma ni `next/cache` aquí. La server
 * action (`actions/summaries.ts`) se encarga del cache wrapper, auth y
 * carga del `StatusReportPayload`.
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
import type { StatusReportPayload } from '@/lib/actions/reports'

export type StatusNarrativePeriod = 'week' | 'month'

export type StatusNarrativeInput = {
  report: StatusReportPayload
  period: StatusNarrativePeriod
}

const PERIOD_LABEL: Record<StatusNarrativePeriod, string> = {
  week: 'semanal',
  month: 'mensual',
}

/**
 * Datos compactos enviados al LLM. Eliminamos campos sensibles (ids
 * técnicos largos) y cortamos listas a top-N para no exceder tokens.
 */
function compactReport(report: StatusReportPayload, period: StatusNarrativePeriod) {
  return {
    project: { name: report.project.name, status: report.project.status },
    period,
    weekOfYear: report.weekOfYear,
    summary: {
      progressPercent: report.summary.progressPercent,
      totalTasks: report.summary.totalTasks,
      completedTasks: report.summary.completedTasks,
      upcomingMilestones: report.summary.upcomingMilestones.slice(0, 5),
    },
    delayedCount: report.delayedTasks.length,
    delayedTopFive: report.delayedTasks.slice(0, 5).map((t) => ({
      title: t.title,
      daysOverdue: t.daysOverdue,
      progress: t.progress,
      owner: t.owner,
    })),
    criticalPathSize: report.criticalPath.length,
  }
}

const STATUS_INSTRUCTION = `Redacta el status report ejecutivo del proyecto. Estructura obligatoria en markdown:

# <titular corto: proyecto y estado del periodo>

## Contexto
Un párrafo (2-3 frases) con el avance global, ventana temporal y qué tan a tiempo va el equipo. Usa los números tal cual.

## Logros del periodo
Un párrafo y/o bullets con los logros más relevantes (ej: tareas DONE, hitos alcanzados, ruta crítica avanzando).

## Alertas
Un párrafo y/o bullets con tareas atrasadas, hitos en riesgo y métricas en rojo. Si no hay atrasos, dilo así explícitamente.

## Próximos pasos
1-3 acciones sugeridas, accionables, asignables.

## Recomendaciones
1-3 bullets accionables.`

// ─────────────────────────── Heurística ───────────────────────────────

/**
 * Genera la narrativa sin LLM. Determinista, pura, sirve como fallback y
 * baseline para tests.
 */
export function generateStatusNarrativeHeuristic(
  input: StatusNarrativeInput,
  now: Date = new Date(),
): Narrative {
  const { report, period } = input
  const { project, summary } = report
  const delayedCount = report.delayedTasks.length
  const milestonesCount = summary.upcomingMilestones.length
  const criticalCount = report.criticalPath.length

  const headline =
    delayedCount === 0
      ? `${project.name}: avance ${summary.progressPercent}% sin tareas atrasadas`
      : `${project.name}: ${delayedCount} tarea(s) atrasada(s), avance ${summary.progressPercent}%`

  const lines: string[] = []
  lines.push(`# ${headline}`)
  lines.push('')

  // Contexto
  lines.push('## Contexto')
  lines.push(
    `Reporte ${PERIOD_LABEL[period]} del proyecto **${project.name}** (estado: ${project.status}). Avance global: **${summary.progressPercent}%** (${summary.completedTasks}/${summary.totalTasks} tareas DONE). Ruta crítica: ${criticalCount} tarea(s).`,
  )
  lines.push('')

  // Logros
  lines.push('## Logros del periodo')
  if (summary.completedTasks > 0) {
    lines.push(
      `- ${summary.completedTasks} tarea(s) completada(s) en el periodo.`,
    )
  } else {
    lines.push('- No se registraron tareas completadas en este periodo.')
  }
  if (criticalCount > 0) {
    lines.push(`- ${criticalCount} tarea(s) activa(s) en la ruta crítica.`)
  }
  lines.push('')

  // Alertas
  lines.push('## Alertas')
  if (delayedCount === 0) {
    lines.push('- Sin tareas atrasadas reportadas.')
  } else {
    const top = report.delayedTasks.slice(0, 3)
    lines.push(`- **${delayedCount} tarea(s) atrasada(s)**. Top:`)
    for (const t of top) {
      lines.push(
        `  - ${t.title} — ${t.daysOverdue} día(s) de atraso, ${t.progress}% completado${t.owner ? ` (${t.owner})` : ''}.`,
      )
    }
  }
  if (milestonesCount > 0) {
    lines.push(
      `- ${milestonesCount} hito(s) próximo(s) en los siguientes 7 días.`,
    )
  }
  lines.push('')

  // Próximos pasos
  lines.push('## Próximos pasos')
  const nextSteps: string[] = []
  if (delayedCount > 0) {
    nextSteps.push(
      `Recuperar las ${Math.min(3, delayedCount)} tarea(s) más atrasada(s).`,
    )
  }
  if (milestonesCount > 0) {
    nextSteps.push(
      `Cerrar los ${milestonesCount} hito(s) que vencen en los próximos 7 días.`,
    )
  }
  if (criticalCount > 0) {
    nextSteps.push('Revisar dependencias en la ruta crítica.')
  }
  if (nextSteps.length === 0) {
    nextSteps.push('Mantener cadencia actual; no hay alertas relevantes.')
  }
  for (const s of nextSteps) lines.push(`- ${s}`)
  lines.push('')

  // Recomendaciones
  const recommendations: string[] = []
  if (delayedCount >= 3) {
    recommendations.push(
      'Convocar reunión de seguimiento con responsables de tareas atrasadas.',
    )
  }
  if (summary.progressPercent < 50 && summary.totalTasks > 0) {
    recommendations.push(
      'Revisar alcance: avance global por debajo del 50%.',
    )
  }
  if (recommendations.length === 0) {
    recommendations.push('Continuar monitoreo regular del proyecto.')
  }

  lines.push('## Recomendaciones')
  for (const r of recommendations) lines.push(`- ${r}`)

  const keyPoints: string[] = []
  keyPoints.push(`Avance ${summary.progressPercent}%`)
  keyPoints.push(`${summary.completedTasks}/${summary.totalTasks} tareas DONE`)
  if (delayedCount > 0) keyPoints.push(`${delayedCount} tarea(s) atrasada(s)`)
  if (milestonesCount > 0) keyPoints.push(`${milestonesCount} hito(s) próximo(s)`)

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

/**
 * Ruta principal: intenta LLM, cae a heurística. Pública para tests.
 */
export async function generateStatusNarrative(
  input: StatusNarrativeInput,
  now: Date = new Date(),
): Promise<Narrative> {
  const compact = compactReport(input.report, input.period)
  const fallback = () => generateStatusNarrativeHeuristic(input, now)

  return withFallback(async () => {
    const userMessage = buildUserMessage({
      instruction: STATUS_INSTRUCTION,
      data: compact,
      outputHint:
        'Devuelve únicamente markdown. No envuelvas la respuesta en bloque de código.',
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
