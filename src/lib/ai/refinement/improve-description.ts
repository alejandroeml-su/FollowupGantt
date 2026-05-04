/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — "Mejorar descripción".
 *
 * Expande un título corto a una descripción técnica clara, criterios
 * de aceptación y riesgos identificados. Cuando el LLM no está
 * disponible (sin `ANTHROPIC_API_KEY`), caemos a una heurística local
 * que al menos ayuda al usuario con un esqueleto editable.
 */

import {
  ImproveDescriptionSchema,
  type ImproveDescriptionResult,
  type RefinementResultEnvelope,
} from './schemas'
import {
  callLLMObject,
  buildImproveDescriptionPrompt,
  SYSTEM_IMPROVE_DESCRIPTION,
  LLMDisabledError,
  LLMCallError,
} from './prompts'

export interface ImproveDescriptionInput {
  title: string
  currentDescription?: string | null
  projectContext?: string | null
}

/**
 * Heurística local determinista cuando el LLM no está disponible.
 * Genera una plantilla útil con criterios y riesgos genéricos basados
 * en el título. No pretende ser tan rica como el LLM, pero da un
 * punto de partida editable.
 */
export function improveDescriptionHeuristic(
  input: ImproveDescriptionInput,
): ImproveDescriptionResult {
  const title = (input.title ?? '').trim()
  const current = (input.currentDescription ?? '').trim()

  const base = current.length > 0
    ? current
    : `${title}. Esta tarea requiere planificar el alcance, ejecutar la implementación y validar el resultado con los stakeholders.`

  const improvedDescription =
    `${base}\n\nObjetivo: completar "${title}" con calidad y dentro del plazo acordado.`

  const acceptanceCriteria = [
    `Definir claramente el alcance de "${title}"`,
    'Implementar la solución cumpliendo los estándares del proyecto',
    'Validar el resultado con el responsable o stakeholder',
    'Documentar las decisiones relevantes',
  ]

  const risks = [
    'Alcance no acotado: posibles cambios de requerimientos durante la ejecución',
    'Dependencias externas que pueden bloquear el avance',
  ]

  return {
    improvedDescription,
    acceptanceCriteria,
    risks,
  }
}

/**
 * Mejora la descripción de una task. Prefiere LLM; cae a heurística
 * cuando no hay API key o el modelo falla.
 */
export async function improveDescription(
  input: ImproveDescriptionInput,
): Promise<RefinementResultEnvelope<ImproveDescriptionResult>> {
  const safeTitle = (input.title ?? '').trim()
  if (safeTitle.length === 0) {
    throw new Error('[INVALID_INPUT] El título no puede estar vacío')
  }

  try {
    const data = await callLLMObject({
      system: SYSTEM_IMPROVE_DESCRIPTION,
      prompt: buildImproveDescriptionPrompt({ ...input, title: safeTitle }),
      schema: ImproveDescriptionSchema,
      cacheTtlMs: 60 * 60 * 1000, // 1 hora
      cacheKey: 'improve-description',
    })
    return { source: 'llm', data }
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return {
        source: 'heuristic',
        data: improveDescriptionHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'ANTHROPIC_API_KEY no configurada',
      }
    }
    if (err instanceof LLMCallError) {
      return {
        source: 'heuristic',
        data: improveDescriptionHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'La llamada al modelo falló',
      }
    }
    throw err
  }
}
