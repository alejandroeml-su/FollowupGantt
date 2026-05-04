/**
 * Ola P7 · Equipo P7-3 · Executive briefing del portafolio
 *
 * Convierte un `PortfolioReport` (cross-project, calculado por P5-3) en
 * un briefing de 1 página: estado general, top 3 proyectos en riesgo,
 * oportunidades, decisión requerida.
 *
 * Tono: ejecutivo, conciso, accionable. Audiencia: comité directivo.
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
import type { PortfolioReport } from '@/lib/reports/portfolio'

export type ExecutiveBriefingInput = {
  portfolio: PortfolioReport
}

const BRIEFING_INSTRUCTION = `Redacta un executive briefing de portafolio (1 página). Estructura obligatoria en markdown:

# <titular ejecutivo del portafolio>

## Estado general
Un párrafo: cuántos proyectos en verde/amarillo/rojo, avance promedio, SPI/CPI promedio si están disponibles.

## Top 3 proyectos en riesgo
Bullets con los proyectos en rojo o con SPI<1; máximo 3.

## Oportunidades
1-3 bullets con proyectos en verde/saludables que pueden absorber capacidad o servir de modelo.

## Decisión requerida
1 frase: qué decisión necesita el comité (ej. asignar recursos, reescalar alcance, mantener curso).

## Recomendaciones
1-3 bullets accionables priorizadas.`

function compactPortfolio(report: PortfolioReport) {
  const top3Risk = [...report.rows]
    .filter((r) => r.health === 'red' || r.health === 'yellow')
    .sort((a, b) => {
      // priorizar red > yellow, luego SPI más bajo
      const healthRank = (h: string) =>
        h === 'red' ? 0 : h === 'yellow' ? 1 : 2
      const ha = healthRank(a.health)
      const hb = healthRank(b.health)
      if (ha !== hb) return ha - hb
      const sa = a.spi ?? 1
      const sb = b.spi ?? 1
      return sa - sb
    })
    .slice(0, 3)
    .map((r) => ({
      name: r.name,
      health: r.health,
      spi: r.spi,
      cpi: r.cpi,
      progress: r.progressPercent,
      cv: r.cv,
    }))

  const greens = report.rows.filter((r) => r.health === 'green').slice(0, 3)
  const opportunities = greens.map((r) => ({
    name: r.name,
    progress: r.progressPercent,
    spi: r.spi,
  }))

  return {
    summary: report.summary,
    top3Risk,
    opportunities,
    totalRows: report.rows.length,
  }
}

// ─────────────────────────── Heurística ───────────────────────────────

export function generateExecutiveBriefingHeuristic(
  input: ExecutiveBriefingInput,
  now: Date = new Date(),
): Narrative {
  const { portfolio } = input
  const { summary } = portfolio

  const breakdown = summary.healthBreakdown
  const headline =
    breakdown.red > 0
      ? `Portafolio con ${breakdown.red} proyecto(s) crítico(s)`
      : breakdown.yellow > 0
      ? `Portafolio en margen: ${breakdown.yellow} proyecto(s) requieren atención`
      : `Portafolio saludable: ${breakdown.green} proyecto(s) en verde`

  const lines: string[] = []
  lines.push(`# ${headline}`)
  lines.push('')

  // Estado general
  lines.push('## Estado general')
  const spiTxt = summary.avgSPI != null ? summary.avgSPI.toFixed(2) : '—'
  const cpiTxt = summary.avgCPI != null ? summary.avgCPI.toFixed(2) : '—'
  lines.push(
    `Total: **${summary.totalProjects} proyecto(s)** (${summary.activeProjects} activo(s), ${summary.completedProjects} completado(s)). Salud: ${breakdown.green} verde / ${breakdown.yellow} amarillo / ${breakdown.red} rojo / ${breakdown.gray} sin datos. Avance promedio: **${summary.avgProgress}%**. SPI/CPI promedio: ${spiTxt}/${cpiTxt}.`,
  )
  lines.push('')

  // Top 3 riesgo
  lines.push('## Top 3 proyectos en riesgo')
  const compact = compactPortfolio(portfolio)
  if (compact.top3Risk.length === 0) {
    lines.push('- Sin proyectos en estado crítico ni en margen.')
  } else {
    for (const r of compact.top3Risk) {
      const spiPart = r.spi != null ? ` SPI ${r.spi.toFixed(2)}` : ''
      const cpiPart = r.cpi != null ? ` · CPI ${r.cpi.toFixed(2)}` : ''
      lines.push(
        `- **${r.name}** — salud ${r.health}, avance ${r.progress}%${spiPart}${cpiPart}.`,
      )
    }
  }
  lines.push('')

  // Oportunidades
  lines.push('## Oportunidades')
  if (compact.opportunities.length === 0) {
    lines.push(
      '- No hay proyectos en verde para destacar como modelo en este momento.',
    )
  } else {
    for (const o of compact.opportunities) {
      const spiPart = o.spi != null ? ` (SPI ${o.spi.toFixed(2)})` : ''
      lines.push(`- **${o.name}** — avance ${o.progress}%${spiPart}.`)
    }
  }
  lines.push('')

  // Decisión requerida
  lines.push('## Decisión requerida')
  if (breakdown.red > 0) {
    lines.push(
      `Priorizar atención sobre los ${breakdown.red} proyecto(s) en rojo: definir si se reasignan recursos o se reescala alcance.`,
    )
  } else if (breakdown.yellow > 0) {
    lines.push(
      `Aprobar plan de remediación para los ${breakdown.yellow} proyecto(s) en margen.`,
    )
  } else {
    lines.push('Mantener curso actual; portafolio dentro de parámetros.')
  }
  lines.push('')

  // Recomendaciones
  const recommendations: string[] = []
  if (breakdown.red >= 2) {
    recommendations.push(
      'Convocar comité extraordinario para los proyectos en rojo.',
    )
  }
  if (summary.avgSPI != null && summary.avgSPI < 0.9) {
    recommendations.push(
      'Revisar planificación: SPI promedio por debajo del umbral 0.9.',
    )
  }
  if (breakdown.gray > 0) {
    recommendations.push(
      `${breakdown.gray} proyecto(s) sin datos de presupuesto: cargar EVM para visibilidad.`,
    )
  }
  if (recommendations.length === 0) {
    recommendations.push('Continuar cadencia actual de revisión mensual.')
  }
  lines.push('## Recomendaciones')
  for (const r of recommendations) lines.push(`- ${r}`)

  const keyPoints: string[] = [
    `${summary.totalProjects} proyectos total`,
    `${breakdown.red} crítico(s) / ${breakdown.yellow} en margen`,
    `Avance promedio ${summary.avgProgress}%`,
  ]
  if (summary.avgSPI != null) keyPoints.push(`SPI ${summary.avgSPI.toFixed(2)}`)

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

export async function generateExecutiveBriefing(
  input: ExecutiveBriefingInput,
  now: Date = new Date(),
): Promise<Narrative> {
  const compact = compactPortfolio(input.portfolio)
  const fallback = () => generateExecutiveBriefingHeuristic(input, now)

  return withFallback(async () => {
    const userMessage = buildUserMessage({
      instruction: BRIEFING_INSTRUCTION,
      data: compact,
      outputHint:
        'Devuelve markdown. Sé directo, no agregues secciones adicionales.',
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
