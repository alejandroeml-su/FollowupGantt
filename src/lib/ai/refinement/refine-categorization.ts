/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — "Refinar categorización".
 *
 * Sugiere `type` y `priority` para una task con razonamiento del LLM.
 * Extiende — no reemplaza — la heurística determinista P5-4
 * (`categorizeTask`): le pasamos como pista la categoría detectada
 * para que el LLM la confirme o la corrija.
 *
 * Cuando el LLM no está disponible, el fallback usa directamente la
 * heurística P5-4 traduciendo `suggestedTaskType` → `suggestedType` y
 * derivando `priority` de pistas léxicas (CRITICAL/HIGH si aparecen
 * "urgente", "crítico", "bloqueador"; LOW si aparece "nice-to-have"
 * o "opcional"; MEDIUM en otro caso).
 */

import {
  RefineCategorizationSchema,
  type RefineCategorizationResult,
  type RefinementResultEnvelope,
} from './schemas'
import {
  callLLMObject,
  buildRefineCategorizationPrompt,
  SYSTEM_REFINE_CATEGORIZATION,
  LLMDisabledError,
  LLMCallError,
} from './prompts'
import { categorizeTask } from '@/lib/ai/categorize'

export interface RefineCategorizationInput {
  title: string
  description?: string | null
  /** Type actual de la task (PHASE | AGILE_STORY | PMI_TASK | ITIL_TICKET). */
  currentType: string
  /** Priority actual (LOW | MEDIUM | HIGH | CRITICAL). */
  currentPriority: string
}

const HIGH_PRIORITY_HINTS = [
  'urgente',
  'urgent',
  'critico',
  'critical',
  'bloqueador',
  'blocker',
  'asap',
  'inmediato',
  'production',
  'produccion',
  'down',
  'caido',
]

const LOW_PRIORITY_HINTS = [
  'nice-to-have',
  'nice to have',
  'opcional',
  'optional',
  'eventualmente',
  'futuro',
  'backlog',
]

function detectPriorityFromText(text: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const t = text.toLowerCase()
  if (HIGH_PRIORITY_HINTS.some((kw) => t.includes(kw))) {
    return t.includes('critical') || t.includes('critico') ? 'CRITICAL' : 'HIGH'
  }
  if (LOW_PRIORITY_HINTS.some((kw) => t.includes(kw))) return 'LOW'
  return 'MEDIUM'
}

export function refineCategorizationHeuristic(
  input: RefineCategorizationInput,
): RefineCategorizationResult {
  const cat = categorizeTask(input.title, input.description ?? null)
  const text = `${input.title}\n${input.description ?? ''}`
  const suggestedPriority = detectPriorityFromText(text)

  // Mapeo fallback. La heurística P5-4 no contempla PHASE, así que si el
  // título contiene "fase" / "milestone" lo respetamos; si no, usamos su
  // sugerencia.
  let suggestedType: RefineCategorizationResult['suggestedType']
  const lower = text.toLowerCase()
  if (
    /\b(fase|phase|milestone|hito|entrega|delivery)\b/.test(
      lower
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, ''),
    )
  ) {
    suggestedType = 'PHASE'
  } else {
    suggestedType = cat.suggestedTaskType
  }

  const reasoning =
    cat.reasoning.length > 0
      ? `Heurística determinista (P5-4): ${cat.reasoning.join('; ')}. Prioridad inferida del texto: ${suggestedPriority}.`
      : `Sin coincidencias léxicas claras. Por defecto: ${suggestedType} con prioridad ${suggestedPriority}.`

  return {
    suggestedType,
    suggestedPriority,
    reasoning,
  }
}

export async function refineCategorization(
  input: RefineCategorizationInput,
): Promise<RefinementResultEnvelope<RefineCategorizationResult>> {
  const safeTitle = (input.title ?? '').trim()
  if (safeTitle.length === 0) {
    throw new Error('[INVALID_INPUT] El título no puede estar vacío')
  }

  // Calculamos la pista heurística siempre — el LLM la usa como input
  // adicional, y nos sirve también de fallback.
  const heuristic = categorizeTask(safeTitle, input.description ?? null)

  try {
    const data = await callLLMObject({
      system: SYSTEM_REFINE_CATEGORIZATION,
      prompt: buildRefineCategorizationPrompt({
        ...input,
        title: safeTitle,
        heuristicHint: {
          suggestedType: heuristic.suggestedTaskType,
          reasoning: heuristic.reasoning,
        },
      }),
      schema: RefineCategorizationSchema,
      cacheTtlMs: 60 * 60 * 1000,
      cacheKey: 'refine-categorization',
    })
    return { source: 'llm', data }
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return {
        source: 'heuristic',
        data: refineCategorizationHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'ANTHROPIC_API_KEY no configurada',
      }
    }
    if (err instanceof LLMCallError) {
      return {
        source: 'heuristic',
        data: refineCategorizationHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'La llamada al modelo falló',
      }
    }
    throw err
  }
}
