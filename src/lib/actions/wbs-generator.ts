'use server'

/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Server Action `generateWBSFromBrief`.
 *
 * Orquesta:
 *   1. requireUser (autenticación obligatoria).
 *   2. Validación zod del input.
 *   3. PII redaction (vía adapter).
 *   4. withFallback(LLM, heurística).
 *   5. Devuelve `{ wbs, source, warnings, ... }` para preview en UI.
 *
 * No persiste nada en BD: ese es el rol de `applyGeneratedWBS`. Esto
 * permite mostrar preview al usuario antes de comprometer cambios.
 */

import { z } from 'zod'
import { requireUser } from '@/lib/auth/get-current-user'
import { withFallback, redactPII } from '@/lib/ai/llm'
import {
  generateWBSFromBriefLLM,
  type GenerateLLMResult,
} from '@/lib/ai/wbs/generate-wbs'
import {
  generateWBSFromBriefHeuristic,
  type TemplateId,
} from '@/lib/ai/wbs/heuristic-wbs'
import type { WBSGenerated } from '@/lib/ai/wbs/wbs-schema'

// ─────────────────────────── Errores tipados ───────────────────────────

export type WBSGenErrorCode = 'INVALID_INPUT' | 'LLM_FAILED' | 'UNAUTHORIZED'

function actionError(code: WBSGenErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schema de input ───────────────────────────

const generateBriefInputSchema = z.object({
  brief: z
    .string()
    .min(10, 'El brief debe tener al menos 10 caracteres')
    .max(2000, 'El brief no puede exceder 2000 caracteres'),
  projectName: z.string().min(1).max(100).optional(),
  teamSize: z.number().int().min(1).max(500).optional(),
  /** Idioma de salida sugerido al LLM. Default 'es'. */
  language: z.enum(['es', 'en']).optional(),
})

export type GenerateWBSInput = z.input<typeof generateBriefInputSchema>

// ─────────────────────────── Resultado público ─────────────────────────

export interface GenerateWBSResult {
  wbs: WBSGenerated
  source: 'llm' | 'heuristic'
  /** Warnings acumulados (deps inválidas, ciclos, etc.). */
  warnings: string[]
  /** Mensaje de error del LLM si cayó al fallback. */
  llmError?: string
  /** Template usado por la heurística (si source = 'heuristic'). */
  templateId?: TemplateId
  /** Métricas del LLM (sólo si source = 'llm'). */
  tokensUsed?: number
  fromCache?: boolean
  provider?: string
}

// ─────────────────────────── Action ────────────────────────────────────

/**
 * Genera un WBS desde un brief en lenguaje natural. Aplica PII redaction
 * antes de enviar al LLM y cae al fallback heurístico determinista si
 * el LLM no responde.
 */
export async function generateWBSFromBrief(
  input: GenerateWBSInput,
): Promise<GenerateWBSResult> {
  // 2026-05-14 · Edwin reportó 500 en /projects al "Generar". El error
  // real se omitía en producción por el wrapping de Next.js. Envolvemos
  // toda la acción en try/catch para:
  //   1. Loguear el stack completo a Vercel logs (visible en monitoring)
  //   2. Devolver una respuesta heurística graceful como fallback final
  //      (en lugar de propagar el error y mostrar pantalla genérica)
  try {
    await requireUser()

    const parsed = generateBriefInputSchema.safeParse(input)
    if (!parsed.success) {
      actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Input inválido')
    }
    const { brief, projectName, teamSize, language } = parsed.data

    const safeBrief = redactPII(brief)

    const { value, source, primaryError } = await withFallback<
      | { kind: 'llm'; data: GenerateLLMResult }
      | { kind: 'heuristic'; templateId: TemplateId; wbs: WBSGenerated }
    >(
      async () => {
        const llm = await generateWBSFromBriefLLM(safeBrief, {
          projectName,
          teamSize,
          language: language ?? 'es',
        })
        return { kind: 'llm', data: llm }
      },
      async () => {
        const h = generateWBSFromBriefHeuristic(safeBrief, { projectName, teamSize })
        return { kind: 'heuristic', templateId: h.templateId, wbs: h.wbs }
      },
    )

    if (source === 'primary' && value.kind === 'llm') {
      return {
        wbs: value.data.wbs,
        source: 'llm',
        warnings: value.data.warnings,
        tokensUsed: value.data.tokensUsed,
        fromCache: value.data.fromCache,
        provider: value.data.provider,
      }
    }
    if (value.kind === 'heuristic') {
      return {
        wbs: value.wbs,
        source: 'heuristic',
        warnings: [],
        llmError: primaryError,
        templateId: value.templateId,
      }
    }
    // Caso defensivo (no alcanzable) — el discriminator debería cubrir todo.
    actionError('LLM_FAILED', 'Generación falló y el fallback no produjo resultado')
  } catch (err) {
    // Logear a Vercel logs con detalle (visible en `vercel logs` y en
    // el dashboard de funciones). El mensaje cliente sigue siendo el
    // genérico que Next.js inyecta en producción.
    console.error('[generateWBSFromBrief] ERROR', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      inputBrief: input.brief?.slice(0, 100),
      inputProjectName: input.projectName,
    })

    // Fallback final: si el LLM falla Y el heurístico falla por
    // cualquier razón, devolvemos una WBS mínima con una sola fase.
    // Mejor un proyecto vacío editable que un 500 sin contexto.
    if (
      err instanceof Error &&
      /\[INVALID_INPUT\]|\[UNAUTHORIZED\]/.test(err.message)
    ) {
      // Errores de input/auth se re-lanzan (el cliente sí los traduce).
      throw err
    }
    return {
      wbs: {
        projectName: input.projectName?.trim() || 'Proyecto sin título',
        description: 'WBS de emergencia generada tras fallo de IA. Edita las fases manualmente.',
        estimatedDurationDays: 30,
        phases: [
          {
            name: 'Planificación',
            order: 0,
            tasks: [
              {
                title: 'Definir alcance y objetivos',
                type: 'PMI_TASK',
                estimatedDays: 5,
                priority: 'HIGH',
              },
            ],
          },
        ],
      },
      source: 'heuristic',
      warnings: [
        'La IA falló y el fallback heurístico también. Se generó una WBS mínima.',
        err instanceof Error ? err.message : String(err),
      ],
      llmError: err instanceof Error ? err.message : 'Error desconocido',
      templateId: 'software-project',
    }
  }
}
