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
  /** Wave P14c — Mnemonic de la task que origina el riesgo (preferido).
   *  Si no hay task específica, null. El backend lo resuelve a `taskId`
   *  al persistir el riesgo. */
  taskMnemonic: z.string().nullable(),
  title: z.string().describe('Título corto del riesgo (5-10 palabras).'),
  rationale: z
    .string()
    .describe('Explicación de 1-2 frases del por qué es riesgo, con datos concretos.'),
  suggestedAction: z
    .string()
    .describe('Mitigación accionable concreta (lo que `Risk.mitigation` guarda).'),
  /** PMBOK · matriz 5×5. */
  probability: z.number().int().min(1).max(5)
    .describe('Probabilidad 1-5 según matriz PMBOK 5×5 (1 = muy improbable, 5 = casi seguro).'),
  impact: z.number().int().min(1).max(5)
    .describe('Impacto 1-5 según matriz PMBOK 5×5 (1 = trivial, 5 = catastrófico para el proyecto).'),
  /** Días extra al cronograma si el riesgo se materializa (Monte Carlo). */
  triggerDelayDays: z.number().int().min(0).max(180).nullable()
    .describe('Días corridos extra al cronograma si se materializa. Null si no aplica delay temporal.'),
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
