/**
 * HU-3.1 · Snapshot de línea base.
 *
 * Lógica pura para construir el `snapshotData` que se persiste en la
 * tabla `Baseline`. Se aísla del Prisma client para que sea testeable
 * sin DB: el caller (server action) carga las tareas y las pasa como
 * argumento.
 *
 * Estructura del snapshot (`schemaVersion: 1`):
 *  - capturedAt: ISO datetime UTC (timestamp de la captura).
 *  - label: string corto opcional (≤80 chars).
 *  - tasks: array con los campos PMI/EVM relevantes para overlay y SV/SPI.
 *
 * Cuando se rompa el formato (ej. nuevos campos), incrementar
 * `schemaVersion` y mantener compat de lectura en `getBaselineSnapshot`.
 */

import { z } from 'zod'

/** Tope soft documentado en la decisión D10 del Sprint 7. */
export const BASELINE_CAP_PER_PROJECT = 20
/** Umbral para warning amarillo en el modal. */
export const BASELINE_WARN_THRESHOLD = 15
/** Longitud máxima del label libre. */
export const BASELINE_LABEL_MAX = 80

// ────────────────────────── Schemas ──────────────────────────

/**
 * Tarea dentro del snapshot. Reflejamos solo las columnas que el overlay
 * (HU-3.3) y los KPIs SV/SPI (HU-3.4) necesitarán; capturar todo el
 * registro Task duplicaría datos innecesariamente.
 */
export const BaselineTaskSchema = z.object({
  id: z.string().min(1),
  mnemonic: z.string().nullable(),
  title: z.string(),
  plannedStart: z.string().datetime().nullable(),
  plannedEnd: z.string().datetime().nullable(),
  plannedValue: z.number().nullable(),
  earnedValue: z.number().nullable(),
  actualCost: z.number().nullable(),
  progress: z.number().nullable(),
  status: z.string(),
})

export type BaselineTask = z.infer<typeof BaselineTaskSchema>

export const BaselineSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  label: z.string().nullable(),
  tasks: z.array(BaselineTaskSchema),
})

export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>

// ────────────────────────── Builders ──────────────────────────

/**
 * Forma minima de Task que necesita el snapshot. Aceptamos `Date` o `string`
 * en las fechas para que sea cómodo invocar desde Prisma (Date) o tests (string).
 */
export type TaskForSnapshot = {
  id: string
  mnemonic: string | null
  title: string
  startDate: Date | string | null
  endDate: Date | string | null
  plannedValue: number | null
  earnedValue: number | null
  actualCost: number | null
  progress: number | null
  status: string
}

function toIsoOrNull(d: Date | string | null | undefined): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString()
  // strings ya formateados pasan tal cual; si no son ISO el zod parse de
  // arriba fallará en `validate*` y devolverá un error semantico.
  return String(d)
}

/**
 * Construye el JSON del snapshot a partir de tareas crudas. Punto único
 * de transformación Date → ISO; el resto del pipeline trabaja con el
 * shape ya serializable.
 *
 * El caller debe asegurar que `tasks` ya esté filtrado por proyecto y
 * que excluya `archivedAt != null` (la regla de archivado se decide en
 * la action, no aquí, para no acoplar lógica de negocio al helper).
 */
export function buildBaselineSnapshot(args: {
  tasks: readonly TaskForSnapshot[]
  capturedAt: Date
  label: string | null
}): BaselineSnapshot {
  const snap: BaselineSnapshot = {
    schemaVersion: 1,
    capturedAt: args.capturedAt.toISOString(),
    label: args.label,
    tasks: args.tasks.map((t) => ({
      id: t.id,
      mnemonic: t.mnemonic ?? null,
      title: t.title,
      plannedStart: toIsoOrNull(t.startDate),
      plannedEnd: toIsoOrNull(t.endDate),
      plannedValue: t.plannedValue ?? null,
      earnedValue: t.earnedValue ?? null,
      actualCost: t.actualCost ?? null,
      progress: t.progress ?? null,
      status: t.status,
    })),
  }
  // Validamos antes de devolver para detectar drift entre el tipo
  // TaskForSnapshot y el schema (ej. si alguien añade un campo no
  // serializable). En tests esto sirve como aserción gratuita.
  return BaselineSnapshotSchema.parse(snap)
}

/**
 * Normaliza un label entrante: trim + truncado a 80. Retorna null si
 * queda vacío. Aislado para reusar en la server action y en el modal.
 */
export function normalizeBaselineLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().slice(0, BASELINE_LABEL_MAX)
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Lee y valida un snapshot persistido. Lanza error tipado
 * `[INVALID_SNAPSHOT]` si el JSON no respeta el schema (ej. baselines
 * pre-existentes con shape distinto, o corrupción manual). El caller
 * debe envolver en try/catch para mostrar toast rojo y degradar.
 */
export function parseBaselineSnapshot(raw: unknown): BaselineSnapshot {
  const parsed = BaselineSnapshotSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `[INVALID_SNAPSHOT] ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    )
  }
  return parsed.data
}
