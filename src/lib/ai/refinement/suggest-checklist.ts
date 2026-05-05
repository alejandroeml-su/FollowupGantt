/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — "Sugerir checklist".
 *
 * A partir del título y descripción de una task, produce 3-7 items
 * accionables y verificables. Heurística de fallback cubre los casos
 * más comunes (DESIGN/BUG/RELEASE/DOCS) reusando palabras clave del
 * P5-4 categorize.
 */

import {
  SuggestChecklistSchema,
  type SuggestChecklistResult,
  type RefinementResultEnvelope,
} from './schemas'
import {
  callLLMObject,
  buildSuggestChecklistPrompt,
  SYSTEM_SUGGEST_CHECKLIST,
} from './prompts'
import { LLMError, LLM_ERROR_CODES } from '@/lib/ai/llm'
import { categorizeTask } from '@/lib/ai/categorize'

export interface SuggestChecklistInput {
  title: string
  description?: string | null
}

const DEFAULT_TEMPLATE: SuggestChecklistResult['items'] = [
  { text: 'Definir alcance y entregable concreto', optional: false },
  { text: 'Identificar dependencias y stakeholders', optional: false },
  { text: 'Implementar la solución', optional: false },
  { text: 'Validar con el responsable', optional: false },
  { text: 'Documentar resultado y decisiones', optional: true },
]

const TEMPLATES_BY_CATEGORY: Record<string, SuggestChecklistResult['items']> = {
  BUG: [
    { text: 'Reproducir el error en entorno controlado', optional: false },
    { text: 'Identificar la causa raíz', optional: false },
    { text: 'Implementar el fix', optional: false },
    { text: 'Añadir test de regresión', optional: false },
    { text: 'Validar en QA / staging', optional: false },
    { text: 'Comunicar el fix a usuarios afectados', optional: true },
  ],
  RELEASE: [
    { text: 'Verificar que todas las features de la release estén DONE', optional: false },
    { text: 'Generar changelog', optional: false },
    { text: 'Ejecutar pipeline de despliegue', optional: false },
    { text: 'Smoke test en producción', optional: false },
    { text: 'Notificar a stakeholders', optional: false },
  ],
  DESIGN: [
    { text: 'Investigar referencias y patrones similares', optional: false },
    { text: 'Producir wireframe o boceto inicial', optional: false },
    { text: 'Iterar diseño con feedback del equipo', optional: false },
    { text: 'Entregar mockup final en Figma', optional: false },
    { text: 'Documentar decisiones de diseño', optional: true },
  ],
  DOCS: [
    { text: 'Identificar audiencia objetivo de la documentación', optional: false },
    { text: 'Crear estructura / outline del documento', optional: false },
    { text: 'Redactar contenido', optional: false },
    { text: 'Revisar con stakeholder técnico', optional: false },
    { text: 'Publicar en wiki o repositorio correspondiente', optional: false },
  ],
  TESTING: [
    { text: 'Definir casos de prueba', optional: false },
    { text: 'Implementar tests automatizados', optional: false },
    { text: 'Ejecutar suite y verificar cobertura', optional: false },
    { text: 'Registrar defectos encontrados', optional: false },
  ],
}

export function suggestChecklistHeuristic(
  input: SuggestChecklistInput,
): SuggestChecklistResult {
  const cat = categorizeTask(input.title, input.description ?? null)
  const items =
    TEMPLATES_BY_CATEGORY[cat.suggestedCategory] ?? DEFAULT_TEMPLATE
  return { items: items.slice(0, 7) }
}

export async function suggestChecklist(
  input: SuggestChecklistInput,
): Promise<RefinementResultEnvelope<SuggestChecklistResult>> {
  const safeTitle = (input.title ?? '').trim()
  if (safeTitle.length === 0) {
    throw new Error('[INVALID_INPUT] El título no puede estar vacío')
  }

  try {
    const data = await callLLMObject({
      system: SYSTEM_SUGGEST_CHECKLIST,
      prompt: buildSuggestChecklistPrompt({ ...input, title: safeTitle }),
      schema: SuggestChecklistSchema,
      cacheTtlMs: 60 * 60 * 1000,
      cacheKey: 'suggest-checklist',
    })
    return { source: 'llm', data }
  } catch (err) {
    if (err instanceof LLMError) {
      if (err.code === LLM_ERROR_CODES.NO_CLIENT) {
        return {
          source: 'heuristic',
          data: suggestChecklistHeuristic({ ...input, title: safeTitle }),
          fallbackReason: 'ANTHROPIC_API_KEY no configurada',
        }
      }
      return {
        source: 'heuristic',
        data: suggestChecklistHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'La llamada al modelo falló',
      }
    }
    throw err
  }
}
