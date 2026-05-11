'use server'

/**
 * Wave P19-C · Brain AI Strategist — Narration server action.
 *
 * Wraps el `StrategistReport` (Wave P19-A) en un brief ejecutivo
 * narrativo. Estrategia:
 *
 *   1. Carga `loadStrategistReport()` (datos crudos cross-project).
 *   2. Si `ANTHROPIC_API_KEY` existe → llama Anthropic (`generateObject`
 *      con `StrategistBriefSchema`, temperature 0.5, max_tokens 800).
 *   3. Si falla LLM o no hay key → `heuristicNarration(report)` fallback.
 *
 * Sin persistencia (mismo criterio que P19-A): cada visita regenera.
 * El output es para consumo humano (copy/paste a correo, no para tracking).
 */

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { loadStrategistReport, type StrategistReport } from './actions'
import {
  StrategistBriefSchema,
  clampBrief,
  heuristicNarration,
  paragraphsToHtml,
  type StrategistNarration,
} from './narration'

interface GenerateStrategistBriefInput {
  /**
   * Reservado para Wave P19-B (balancing/scenarios). Hoy ignorado pero
   * conservamos el flag en la signature para evitar breaking change cuando
   * se integre `loadBalancingSuggestions()`.
   */
  includePredictive?: boolean
}

/**
 * Genera el brief ejecutivo del Strategist. Devuelve siempre una
 * narración usable (LLM o heurístico). Nunca lanza por falta de API key.
 */
export async function generateStrategistBrief(
  _input?: GenerateStrategistBriefInput,
): Promise<StrategistNarration> {
  // Carga datos cross-project (puede lanzar si Prisma falla → lo dejamos
  // propagar: es un error real, no algo de lo que valga la pena fallback).
  const report = await loadStrategistReport()

  // Sin API key → directo a heurística (sin warning, es path normal).
  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback = heuristicNarration(report)
    return {
      ...fallback,
      fallbackReason: 'ANTHROPIC_API_KEY no configurada',
    }
  }

  try {
    const result = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: StrategistBriefSchema,
      temperature: 0.5,
      maxOutputTokens: 800,
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(report),
    })

    const clamped = clampBrief(result.object)
    return {
      briefHtml: paragraphsToHtml(clamped.brief),
      briefText: clamped.brief,
      keyFindings: clamped.keyFindings,
      cta: clamped.cta,
      generatedAt: new Date().toISOString(),
      source: 'llm',
      provider: 'anthropic',
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[BRAIN_AI] Strategist narration LLM fallback:', reason)
    const fallback = heuristicNarration(report)
    return {
      ...fallback,
      fallbackReason: `LLM error: ${reason}`,
    }
  }
}

// ─── Prompts ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `Eres Avante Brain · Strategist Narrator. Conviertes datos crudos
cross-project (resource contention, dependency conflicts, reusable lessons)
en un brief ejecutivo tipo "Mensaje al CEO".

Reglas del brief
────────────────
1. Audiencia: CEO / Sponsor ejecutivo. NO eres un PM hablando con otro PM.
2. Lenguaje claro, directo, en español neutro. Sin jerga técnica,
   sin anglicismos innecesarios. Si usas un término técnico, explícalo en
   la misma frase.
3. NO uses emojis. NO uses markdown (** _ #). Solo texto plano.
4. \`brief\`: EXACTAMENTE 3-5 párrafos. Cada párrafo separado por una línea
   en blanco (doble salto de línea). Cada párrafo 2-4 frases.
5. Estructura sugerida del brief:
   - Párrafo 1: contexto + escala del análisis (proyectos / tareas / deps).
   - Párrafo 2-3: hallazgos materiales (contention + dependencies). Cita
     números reales del JSON de entrada.
   - Párrafo 4: lecciones aplicables / oportunidades de optimización.
   - Párrafo 5: cierre con recomendación accionable al ejecutivo.
6. \`keyFindings\`: ENTRE 3 Y 5 puntos, cada uno una frase corta (15-25
   palabras), accionable, con número/dato concreto. NO redundancia con el
   brief — son puntos para escaneo rápido.
7. \`cta\`: UNA frase imperativa concreta dirigida al ejecutivo (qué hacer,
   cuándo). Ej: "Convocar Steering Committee esta semana para resolver
   los 2 hallazgos HIGH antes del próximo sprint planning."

Tono
────
- Tono ejecutivo, no alarmista. Si HIGH severity → directo y urgente pero
  sin drama. Si todo está sano → reconocer brevemente y proponer cadencia.
- Si los datos son escasos (0 insights) → ser honesto, no inventes.`
}

function buildUserPrompt(report: StrategistReport): string {
  // Reducimos cardinalidad para mantener el prompt bounded (top 6 por
  // categoría es suficiente para escribir un brief ejecutivo).
  const payload = {
    scanned: report.scanned,
    generatedAt: report.generatedAt,
    resourceContention: report.resourceContention.slice(0, 6).map((c) => ({
      severity: c.severity,
      user: c.userName,
      overlapDays: c.overlapDays,
      projects: c.projects.map((p) => ({ name: p.name, taskTitle: p.taskTitle })),
      recommendation: c.recommendation,
    })),
    dependencyConflicts: report.dependencyConflicts.slice(0, 6).map((d) => ({
      severity: d.severity,
      gapDays: d.gapDays,
      predecessor: { title: d.predecessor.title, project: d.predecessor.project },
      successor: { title: d.successor.title, project: d.successor.project },
      recommendation: d.recommendation,
    })),
    reusableLessons: report.reusableLessons.slice(0, 6).map((l) => ({
      title: l.title,
      category: l.category,
      sourceProject: l.sourceProject,
      applicableProjects: l.applicableProjects,
      recommendation: l.recommendation,
    })),
  }

  return `Genera el brief ejecutivo a partir del siguiente análisis cross-project.
Solo usa estos datos — NO inventes proyectos, usuarios, ni números.

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``
}
