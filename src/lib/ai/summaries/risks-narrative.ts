/**
 * Ola P7 · Equipo P7-3 · Risks narrative
 *
 * Convierte la lista de riesgos detectados (DELAY_RISK score>0.6 +
 * violaciones de hard deadline P5-2) en una narrativa "Top N riesgos"
 * agrupada por categoría.
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

export type RiskItem = {
  taskId: string
  taskTitle: string
  score: number // 0..1
  level: 'low' | 'medium' | 'high'
  factors: string[]
  category?: 'DELAY' | 'BUDGET' | 'DEPENDENCY' | 'DEADLINE' | 'OTHER'
}

export type DeadlineViolation = {
  taskId: string
  taskTitle: string
  hardDeadline: string // ISO
  endDate: string | null
  daysOver: number
}

export type RisksNarrativeInput = {
  projectName: string
  risks: ReadonlyArray<RiskItem>
  deadlineViolations: ReadonlyArray<DeadlineViolation>
  /**
   * Umbral mínimo para incluir un risk en el narrative. Default 0.6.
   */
  scoreThreshold?: number
}

const RISKS_INSTRUCTION = `Resume los TOP riesgos del proyecto, agrupados por categoría. Estructura obligatoria en markdown:

# <titular: cuántos riesgos críticos>

## Resumen
Un párrafo (1-2 frases) con totales y severidad general.

## Riesgos por categoría
Subsecciones con bullets. Categorías esperadas: Atrasos, Presupuesto, Dependencias, Fechas tope. Solo incluye las que tengan riesgos. Cada bullet: nombre de la tarea + factores principales.

## Mitigaciones sugeridas
1-3 bullets accionables priorizadas.`

function categorizeRisk(item: RiskItem): RiskItem['category'] {
  if (item.category) return item.category
  const text = item.factors.join(' ').toLowerCase()
  if (text.includes('costo') || text.includes('budget') || text.includes('presupuesto')) {
    return 'BUDGET'
  }
  if (text.includes('depend') || text.includes('predecesor')) {
    return 'DEPENDENCY'
  }
  if (text.includes('deadline') || text.includes('fecha tope')) {
    return 'DEADLINE'
  }
  return 'DELAY'
}

const CATEGORY_LABEL: Record<NonNullable<RiskItem['category']>, string> = {
  DELAY: 'Atrasos',
  BUDGET: 'Presupuesto',
  DEPENDENCY: 'Dependencias',
  DEADLINE: 'Fechas tope',
  OTHER: 'Otros',
}

function compactRisks(input: RisksNarrativeInput) {
  const threshold = input.scoreThreshold ?? 0.6
  const filtered = input.risks
    .filter((r) => r.score >= threshold)
    .slice(0, 10)
  return {
    project: input.projectName,
    threshold,
    risksCount: filtered.length,
    risks: filtered.map((r) => ({
      title: r.taskTitle,
      score: r.score,
      level: r.level,
      category: categorizeRisk(r),
      factors: r.factors.slice(0, 5),
    })),
    deadlineViolations: input.deadlineViolations.slice(0, 5),
  }
}

// ─────────────────────────── Heurística ───────────────────────────────

export function generateRisksNarrativeHeuristic(
  input: RisksNarrativeInput,
  now: Date = new Date(),
): Narrative {
  const threshold = input.scoreThreshold ?? 0.6
  const top = input.risks
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  const violations = input.deadlineViolations

  const grouped = new Map<NonNullable<RiskItem['category']>, RiskItem[]>()
  for (const r of top) {
    const cat = categorizeRisk(r) ?? 'OTHER'
    const list = grouped.get(cat) ?? []
    list.push(r)
    grouped.set(cat, list)
  }

  const totalRisks = top.length + violations.length
  const headline =
    totalRisks === 0
      ? `${input.projectName}: sin riesgos críticos detectados`
      : `${input.projectName}: ${totalRisks} riesgo(s) críticos a monitorear`

  const lines: string[] = []
  lines.push(`# ${headline}`)
  lines.push('')

  // Resumen
  lines.push('## Resumen')
  if (totalRisks === 0) {
    lines.push(
      `No se detectaron riesgos con score >= ${threshold} ni violaciones de fechas tope. Mantener monitoreo regular.`,
    )
  } else {
    const highCount = top.filter((r) => r.level === 'high').length
    lines.push(
      `Se detectaron **${top.length} riesgo(s)** con score >= ${threshold} (de ellos ${highCount} severidad alta) y **${violations.length} violación(es)** de fechas tope (hard deadline).`,
    )
  }
  lines.push('')

  // Por categoría
  lines.push('## Riesgos por categoría')
  if (grouped.size === 0 && violations.length === 0) {
    lines.push('- Sin riesgos categorizables.')
  } else {
    // Riesgos detectados por heurística
    for (const cat of (Object.keys(CATEGORY_LABEL) as Array<
      NonNullable<RiskItem['category']>
    >)) {
      const items = grouped.get(cat)
      if (!items || items.length === 0) continue
      lines.push('')
      lines.push(`### ${CATEGORY_LABEL[cat]}`)
      for (const r of items) {
        const factorsTxt =
          r.factors.length > 0 ? ` — ${r.factors.slice(0, 3).join('; ')}` : ''
        lines.push(
          `- **${r.taskTitle}** (score ${r.score.toFixed(2)}, ${r.level})${factorsTxt}.`,
        )
      }
    }
    // Violaciones de hard deadline
    if (violations.length > 0) {
      lines.push('')
      lines.push('### Fechas tope vencidas')
      for (const v of violations.slice(0, 5)) {
        lines.push(
          `- **${v.taskTitle}** — ${v.daysOver} día(s) sobre la fecha tope (${new Date(v.hardDeadline).toLocaleDateString('es-MX')}).`,
        )
      }
    }
  }
  lines.push('')

  // Mitigaciones
  const mitigations: string[] = []
  if (top.filter((r) => r.level === 'high').length >= 3) {
    mitigations.push(
      'Asignar owner explícito a cada riesgo de severidad alta.',
    )
  }
  if (violations.length > 0) {
    mitigations.push(
      `Escalar las ${violations.length} violación(es) de hard deadline al sponsor.`,
    )
  }
  if (grouped.has('DEPENDENCY') && (grouped.get('DEPENDENCY')?.length ?? 0) > 0) {
    mitigations.push(
      'Revisar dependencias bloqueantes en la siguiente standup.',
    )
  }
  if (mitigations.length === 0) {
    mitigations.push(
      totalRisks === 0
        ? 'No se requieren acciones de mitigación inmediatas.'
        : 'Documentar plan de mitigación para cada riesgo listado.',
    )
  }
  lines.push('## Mitigaciones sugeridas')
  for (const m of mitigations) lines.push(`- ${m}`)

  const keyPoints: string[] = [
    `${top.length} riesgo(s) score >= ${threshold}`,
    `${violations.length} violación(es) de hard deadline`,
  ]
  const highCount = top.filter((r) => r.level === 'high').length
  if (highCount > 0) keyPoints.push(`${highCount} severidad alta`)

  return {
    headline,
    markdown: lines.join('\n'),
    keyPoints,
    recommendations: mitigations,
    source: 'heuristic',
    generatedAt: now.toISOString(),
  }
}

// ─────────────────────────── LLM (con fallback) ───────────────────────

export async function generateRisksNarrative(
  input: RisksNarrativeInput,
  now: Date = new Date(),
): Promise<Narrative> {
  const compact = compactRisks(input)
  const fallback = () => generateRisksNarrativeHeuristic(input, now)

  return withFallback(async () => {
    const userMessage = buildUserMessage({
      instruction: RISKS_INSTRUCTION,
      data: compact,
      outputHint:
        'Devuelve markdown. NO inventes riesgos no listados; si no hay datos en una categoría, omítela.',
    })
    const raw = await callLLM({
      systemPrompt: SYSTEM_PROMPT_PMO,
      userMessage,
      maxTokens: 700,
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
