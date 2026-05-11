/**
 * Wave P19-C · Brain AI Strategist — Narration helper (heurístico puro).
 *
 * Capa LLM opcional encima de los 3 detectores cross-project (Wave P19-A):
 * convierte el `StrategistReport` (datos crudos) en un brief ejecutivo
 * narrativo tipo "Mensaje al CEO" — 3-5 párrafos + 3-5 key findings + 1
 * CTA. Si el LLM no está disponible (sin `ANTHROPIC_API_KEY` o falla),
 * `heuristicNarration()` provee un fallback determinista basado en
 * plantillas que SÍ produce output útil sin depender de la red.
 *
 * Este archivo es PURO (sin Prisma, sin `'use server'`) → testeable y
 * reutilizable desde la server action `narration-actions.ts`.
 */

import { z } from 'zod'
import type { StrategistReport } from './actions'

// ─── Schema zod del Brief generado por el LLM ─────────────────────────
//
// Constraints Anthropic structured output (deuda viva del repo):
//   - NO usar `.min/.max` en `z.number().int()`
//   - NO usar `maxItems`/`minItems` en arrays
//   - Los límites (3-5 párrafos, 3-5 key findings, 1 CTA) se enforced en
//     el system prompt + clamp en JS post-LLM.
//
// Ver `pm-types.ts:80-110` y `wbs-schema.ts:33-40` para los precedentes.

export const StrategistBriefSchema = z.object({
  brief: z
    .string()
    .describe(
      '3-5 párrafos ejecutivos en lenguaje claro, sin jerga técnica. Cada párrafo separado por línea en blanco. Audiencia: CEO / Sponsor.',
    ),
  keyFindings: z
    .array(z.string())
    .describe('Exactamente 3-5 puntos accionables, cada uno una frase corta.'),
  cta: z
    .string()
    .describe('Una llamada a acción concreta (1 frase imperativa).'),
})

export type StrategistBrief = z.infer<typeof StrategistBriefSchema>

// ─── Tipos públicos del narration ─────────────────────────────────────

export interface StrategistNarration {
  briefHtml: string
  briefText: string
  keyFindings: string[]
  cta: string
  generatedAt: string
  source: 'llm' | 'heuristic'
  /** Si `source === 'heuristic'`, motivo legible del fallback. */
  fallbackReason?: string
  /** Identifica el provider que generó el brief (e.g. 'anthropic'). */
  provider?: string
}

// ─── Helpers internos ─────────────────────────────────────────────────

/**
 * Convierte texto plano con párrafos separados por línea en blanco a
 * HTML sanitizado. Solo emite `<p>` (no permite ningún tag interno) →
 * inyección imposible desde el output del LLM o desde plantillas.
 */
export function paragraphsToHtml(text: string): string {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Clamp del output del LLM: garantiza 3-5 key findings y trimea strings.
 * No falla si vienen menos de 3 (devuelve los que haya) ni si vienen más
 * de 5 (corta a 5). Esta es la convención del repo para evitar
 * constraints incompatibles con Anthropic structured output.
 */
export function clampBrief(brief: StrategistBrief): StrategistBrief {
  const briefText = brief.brief.trim()
  const keyFindings = brief.keyFindings
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .slice(0, 5)
  const cta = brief.cta.trim()
  return { brief: briefText, keyFindings, cta }
}

// ─── Heuristic fallback ───────────────────────────────────────────────

/**
 * Construye un brief ejecutivo a partir del `StrategistReport` SIN llamar
 * al LLM. Usa plantillas + agregaciones simples. Output:
 *   - 3-5 párrafos (intro + contention + deps + lessons + cierre)
 *   - 3-5 key findings (los hallazgos más severos)
 *   - 1 CTA contextualizada según el estado global
 */
export function heuristicNarration(
  report: StrategistReport,
): StrategistNarration {
  const generatedAt = new Date().toISOString()

  const totalInsights =
    report.resourceContention.length +
    report.dependencyConflicts.length +
    report.reusableLessons.length

  const highSevContention = report.resourceContention.filter(
    (i) => i.severity === 'HIGH',
  ).length
  const highSevDeps = report.dependencyConflicts.filter(
    (i) => i.severity === 'HIGH',
  ).length

  // ─── Intro (sin emojis ni jerga) ────────────────────────────────────
  const introParts: string[] = []
  introParts.push(
    `Análisis cross-project sobre ${report.scanned.activeProjects} proyectos activos, ${report.scanned.tasks} tareas y ${report.scanned.crossDeps} dependencias inter-proyecto. Se identificaron ${totalInsights} hallazgos relevantes para la dirección.`,
  )

  // ─── Resource contention ────────────────────────────────────────────
  const contentionParts: string[] = []
  if (report.resourceContention.length > 0) {
    const top = report.resourceContention[0]
    contentionParts.push(
      `Hay ${report.resourceContention.length} caso${report.resourceContention.length === 1 ? '' : 's'} de solape de recursos. El más severo: ${top.userName} está asignado simultáneamente a ${top.projects.length} proyectos con ${top.overlapDays} días de traslape, lo que pone en riesgo entregas y aumenta el costo de context-switching.`,
    )
  } else {
    contentionParts.push(
      `La asignación de recursos está bien distribuida cross-project: sin solapes detectados entre los equipos.`,
    )
  }

  // ─── Dependency conflicts ───────────────────────────────────────────
  const depsParts: string[] = []
  if (report.dependencyConflicts.length > 0) {
    const worst = report.dependencyConflicts[0]
    depsParts.push(
      `Detectamos ${report.dependencyConflicts.length} conflicto${report.dependencyConflicts.length === 1 ? '' : 's'} de cronograma en dependencias cruzadas. El de mayor impacto: "${worst.successor.title}" (${worst.successor.project}) inicia ${Math.abs(worst.gapDays)} días antes de que termine su predecesora "${worst.predecessor.title}" (${worst.predecessor.project}). Si no se resecuencia, hay riesgo de retrabajo o de bloquear el proyecto sucesor.`,
    )
  } else {
    depsParts.push(
      `Las dependencias cruzadas entre proyectos están cronológicamente consistentes: ningún sucesor inicia antes de que termine su predecesor.`,
    )
  }

  // ─── Reusable lessons ───────────────────────────────────────────────
  const lessonsParts: string[] = []
  if (report.reusableLessons.length > 0) {
    const top = report.reusableLessons[0]
    lessonsParts.push(
      `Hay ${report.reusableLessons.length} leccion${report.reusableLessons.length === 1 ? '' : 'es'} aprendida${report.reusableLessons.length === 1 ? '' : 's'} en proyectos cerrados que aplica${report.reusableLessons.length === 1 ? '' : 'n'} a iniciativas activas. Destaca "${top.title}" (origen: ${top.sourceProject}, categoría ${top.category}) replicable en ${top.applicableProjects.length} proyectos vigentes.`,
    )
  }

  // ─── Cierre ──────────────────────────────────────────────────────────
  const closingParts: string[] = []
  if (highSevContention + highSevDeps > 0) {
    closingParts.push(
      `Se requiere atención prioritaria del Steering Committee esta semana: ${highSevContention + highSevDeps} hallazgo${highSevContention + highSevDeps === 1 ? '' : 's'} de severidad ALTA puede${highSevContention + highSevDeps === 1 ? '' : 'n'} comprometer hitos de portafolio si no se ajusta plan o alcance.`,
    )
  } else if (totalInsights > 0) {
    closingParts.push(
      `El portafolio se encuentra en estado controlado pero con oportunidades de optimización. Se recomienda procesar los hallazgos en la próxima junta de gobierno de proyectos.`,
    )
  } else {
    closingParts.push(
      `El portafolio está saludable. Mantén la cadencia de revisiones cross-project para detectar tempranamente nuevas señales.`,
    )
  }

  const briefText = [
    introParts.join(' '),
    contentionParts.join(' '),
    depsParts.join(' '),
    lessonsParts.join(' '),
    closingParts.join(' '),
  ]
    .filter((p) => p.length > 0)
    .join('\n\n')

  // ─── Key findings (top severidad) ───────────────────────────────────
  const keyFindings: string[] = []

  for (const c of report.resourceContention.slice(0, 2)) {
    keyFindings.push(
      `${c.userName} solapado ${c.overlapDays} días en ${c.projects.length} proyectos (severidad ${c.severity}).`,
    )
  }
  for (const d of report.dependencyConflicts.slice(0, 2)) {
    keyFindings.push(
      `Cronograma cruzado: "${d.successor.title}" arranca ${Math.abs(d.gapDays)} días antes que termine "${d.predecessor.title}" (severidad ${d.severity}).`,
    )
  }
  for (const l of report.reusableLessons.slice(0, 1)) {
    keyFindings.push(
      `Lección reusable de "${l.sourceProject}" aplicable a ${l.applicableProjects.length} proyectos: ${l.title}.`,
    )
  }
  if (keyFindings.length === 0) {
    keyFindings.push(
      'Portafolio sin solapes ni conflictos detectados; ejecución alineada con plan maestro.',
    )
  }

  // ─── CTA ─────────────────────────────────────────────────────────────
  let cta: string
  if (highSevContention + highSevDeps > 0) {
    cta =
      'Convocar al Steering Committee para resolver los hallazgos HIGH y aprobar reasignaciones o ajustes de cronograma esta semana.'
  } else if (totalInsights > 0) {
    cta =
      'Incluir estos hallazgos en la agenda del próximo Portfolio Review y asignar owner por cada uno.'
  } else {
    cta =
      'Programar la siguiente revisión cross-project en 2 semanas y mantener monitoreo continuo del portafolio.'
  }

  return {
    briefHtml: paragraphsToHtml(briefText),
    briefText,
    keyFindings: keyFindings.slice(0, 5),
    cta,
    generatedAt,
    source: 'heuristic',
  }
}
