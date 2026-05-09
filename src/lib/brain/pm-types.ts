/**
 * Schemas + tipos puros para Project Manager AI.
 *
 * Extraído de `pm-actions.ts` (que es `'use server'`) porque Turbopack
 * rompe `export const Schema` y `export type` en archivos Server Action
 * con un `ReferenceError: X is not defined` en runtime.
 *
 * Patrón establecido en el repo (también aplicado en `saved-views.ts`):
 *   - Archivos `'use server'` SOLO exportan funciones `async`.
 *   - Constantes / schemas / types viven en archivos puros gemelos.
 */

import { z } from 'zod'

// ─── Standup ──────────────────────────────────────────────────────

export const StandupReportSchema = z.object({
  date: z.string().describe('Fecha del stand-up en formato YYYY-MM-DD.'),
  summary: z
    .string()
    .describe('Resumen ejecutivo de 1-2 frases sobre la actividad de hoy.'),
  byUser: z
    .array(
      z.object({
        userName: z.string(),
        completedToday: z.array(
          z.object({
            mnemonic: z.string().nullable(),
            title: z.string(),
            project: z.string().nullable(),
          }),
        ),
        inProgress: z.array(
          z.object({
            mnemonic: z.string().nullable(),
            title: z.string(),
            progress: z.number(),
            project: z.string().nullable(),
          }),
        ),
      }),
    )
    .describe('Actividad agrupada por usuario.'),
  blockers: z
    .array(z.string())
    .describe('Cuellos de botella o tareas detenidas que requieren atención.'),
  globalProgressNote: z
    .string()
    .describe('Nota corta sobre avance global o tendencia.'),
})

export type StandupReport = z.infer<typeof StandupReportSchema>

// ─── Risk analysis ────────────────────────────────────────────────

export const RiskAlertSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  type: z.enum([
    'OVERDUE',
    'CRITICAL_TASK',
    'EVM_DEVIATION',
    'DEPENDENCY_VIOLATION',
    'STALE',
  ]),
  /** Wave P14c — Mnemonic de la task que origina el riesgo. Vacío si
   *  el riesgo es global del proyecto (ej. EVM_DEVIATION).
   *  Anthropic structured output trata mejor optional que nullable. */
  taskMnemonic: z
    .string()
    .optional()
    .describe('Mnemonic de la task asociada (ej. "p9-3"), o vacío si es global del proyecto.'),
  title: z.string().describe('Título corto del riesgo (5-10 palabras).'),
  rationale: z
    .string()
    .describe('Explicación de 1-2 frases del por qué es riesgo, con datos concretos.'),
  suggestedAction: z
    .string()
    .describe('Mitigación accionable concreta (lo que `Risk.mitigation` guarda).'),
  /** PMBOK · matriz 5×5. NOTA: NO usar `.min/.max` aquí — Anthropic
   *  structured output rechaza `minimum`/`maximum` en `integer` type:
   *  "output_config.format.schema: For 'integer' type, properties
   *  maximum, minimum are not supported". El rango (1-5 / 0-180) se
   *  enforced en el system prompt + clamp en `registerRiskFromAlert`. */
  probability: z
    .number()
    .int()
    .describe('Probabilidad ENTRE 1 y 5 según matriz PMBOK 5×5 (1=muy improbable, 5=casi seguro).'),
  impact: z
    .number()
    .int()
    .describe('Impacto ENTRE 1 y 5 según matriz PMBOK 5×5 (1=trivial, 5=catastrófico).'),
  /** Días extra al cronograma si el riesgo se materializa.
   *  0 = sin delay, valor positivo = días que añade al cronograma. */
  triggerDelayDays: z
    .number()
    .int()
    .describe('Días corridos extra al cronograma si se materializa. ENTRE 0 y 180. 0 si no aplica.'),
})

export const RiskReportSchema = z.object({
  date: z.string(),
  overallStatus: z.enum(['HEALTHY', 'AT_RISK', 'CRITICAL']),
  headline: z.string().describe('Frase de titular sobre el estado general.'),
  // NOTA: NO usar `.max(N)` aquí — Anthropic structured output rechaza
  // `maxItems` con: "output_config.format.schema: For 'array' type,
  // property 'maxItems' is not supported". El límite (top 5) se enforced
  // vía system prompt.
  alerts: z
    .array(RiskAlertSchema)
    .describe('Top 5 alertas priorizadas por severidad (máx 5).'),
})

export type RiskAlert = z.infer<typeof RiskAlertSchema>
export type RiskReport = z.infer<typeof RiskReportSchema>

// ─── Wave P14c · Register risk inputs/outputs ─────────────────────

export interface RegisterRiskInput {
  projectId: string
  alert: RiskAlert
  /** Si null/undefined, el backend intenta resolver por taskMnemonic. */
  taskId?: string | null
}

export interface RegisterRiskResult {
  riskId: string
  taskId: string | null
}

export interface BrainProjectOption {
  id: string
  name: string
  methodology: string
  status: string
}
