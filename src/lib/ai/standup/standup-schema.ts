/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Schema zod del output del LLM.
 *
 * Define el shape estricto del standup generado por
 * `generate-standup.ts`. Se usa tanto como `schema` de `generateObject`
 * (Anthropic SDK) como para validar el output de la heurística fallback,
 * garantizando que el render UI (StandupView) y el cron (Slack dispatch)
 * pueden asumir un único contrato.
 *
 * Convenciones del repo aplicadas:
 *   - Strings en español (es-GT) por default; el campo `lang` queda
 *     reservado para futura internacionalización.
 *   - `summaryShort` <= 240 chars (compatible con DM Slack / push).
 *   - `summaryFull` markdown corto (5-7 líneas), apto para render.
 *   - Listas por usuario (no global) para que el formateador a Slack
 *     pueda hacer `<@user>` cuando exista mapeo email→Slack ID.
 */

import { z } from 'zod'

// ─────────────────────────── Constantes ────────────────────────────────

export const STANDUP_TONE = ['formal', 'casual'] as const
export const STANDUP_FORMAT = ['standup', 'briefing'] as const

export type StandupTone = (typeof STANDUP_TONE)[number]
export type StandupFormat = (typeof STANDUP_FORMAT)[number]

// ─────────────────────────── Item helpers ──────────────────────────────

const userBlockSchema = z.object({
  user: z
    .string()
    .min(1, 'user requerido')
    .max(120, 'user demasiado largo'),
  // NOTA: arrays sin .min/.max — Anthropic structured output no soporta
  // minItems/maxItems. Límites (1..10) enforced en system prompt.
  items: z.array(z.string().min(1).max(280)),
})

const blockerSchema = z.object({
  user: z.string().min(1).max(120),
  description: z
    .string()
    .min(1, 'descripción requerida')
    .max(400, 'descripción demasiado larga'),
  /**
   * Sugerencia opcional generada por el LLM (o heurística) para resolver
   * el bloqueo. La UI lo muestra como "tip" debajo del item.
   */
  suggestedAction: z.string().max(280).optional(),
})

// ─────────────────────────── Schema principal ──────────────────────────

export const standupSchema = z.object({
  /** ISO date (YYYY-MM-DD) — fecha del standup, no del run. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser ISO YYYY-MM-DD'),
  /**
   * Lista de displayName / email de los participantes considerados.
   * Vacío si el scope es individual (`generateUserStandup`).
   */
  // Límite 60 enforced en system prompt (Anthropic rechaza maxItems).
  participants: z.array(z.string().min(1).max(120)),
  /** Tareas DONE en últimas 24h, agrupadas por usuario. */
  yesterday: z.array(userBlockSchema),
  /**
   * Tareas IN_PROGRESS asignadas + hitos próximos, agrupadas por usuario.
   */
  today: z.array(userBlockSchema),
  /** Bloqueos detectados (DELAYED/sin assignee/dependencias rotas). */
  blockers: z.array(blockerSchema),
  /**
   * Resumen de 1 línea (<= 240 chars). Útil para push notifications,
   * mensajes Slack DM y banner del dashboard.
   */
  summaryShort: z
    .string()
    .min(1, 'summaryShort requerido')
    .max(240, 'summaryShort demasiado largo'),
  /**
   * Resumen markdown 5-7 líneas. Render por `StandupView`.
   */
  summaryFull: z
    .string()
    .min(1, 'summaryFull requerido')
    .max(2000, 'summaryFull demasiado largo'),
})

export type Standup = z.infer<typeof standupSchema>

// ─────────────────────────── Helpers de uso ────────────────────────────

/**
 * Valida un payload y devuelve el `Standup` parseado o lanza con prefijo
 * `[INVALID_STANDUP]` para que los callers (server actions, cron) lo
 * propaguen con el formato de error tipado del repo.
 */
export function parseStandup(raw: unknown): Standup {
  const result = standupSchema.safeParse(raw)
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')
    throw new Error(`[INVALID_STANDUP] ${detail}`)
  }
  return result.data
}
