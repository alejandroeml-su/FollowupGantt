/**
 * P3-3 · Backup/Restore — Manifest schema.
 *
 * Esquema canónico del archivo `manifest.json` que viaja dentro del ZIP
 * de export/import full de un proyecto. Validación con zod para que el
 * import rechace archivos malformados antes de tocar la BD.
 *
 * Reglas:
 *   - `schemaVersion` es entero; el import valida que sea soportado
 *     (`SUPPORTED_SCHEMA_VERSIONS`). Versiones futuras se manejarán con
 *     migraciones específicas.
 *   - Los IDs internos del manifest son los UUIDs originales del proyecto
 *     exportado. El importador los regenera y resuelve referencias en
 *     memoria; el manifest es self-contained.
 *   - Fechas se serializan como ISO 8601 strings (zod.coerce.date las
 *     re-hidrata).
 *   - `Json` (custom-fields, baselines snapshot, mind-map metadata) se
 *     mantiene como `unknown` y la validación específica vive en cada
 *     server action que escribe esos modelos.
 */

import { z } from 'zod'

// ───────────────────────── Constantes ─────────────────────────

export const CURRENT_SCHEMA_VERSION = 1 as const
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const

/** Cap de tamaño del ZIP (50 MB) — coincide con el cap del action. */
export const ZIP_SIZE_LIMIT_BYTES = 50 * 1024 * 1024
export const ZIP_SIZE_LIMIT_MB = 50

/** Nombre del manifest dentro del ZIP. */
export const MANIFEST_FILENAME = 'manifest.json'

// ───────────────────────── Enums shape ─────────────────────────

const taskTypeEnum = z.enum(['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET'])
const taskStatusEnum = z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'])
const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
const dependencyTypeEnum = z.enum([
  'FINISH_TO_START',
  'START_TO_START',
  'FINISH_TO_FINISH',
  'START_TO_FINISH',
])
const projectStatusEnum = z.enum([
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
])
const customFieldTypeEnum = z.enum([
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
  'URL',
])

// ───────────────────────── Sub-schemas ─────────────────────────

const isoDate = z.union([z.string(), z.date()]).transform((v) => {
  if (v instanceof Date) return v
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) {
    throw new Error('fecha inválida en manifest')
  }
  return d
})

const optionalIsoDate = isoDate.nullable().optional()

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  status: projectStatusEnum,
  cpi: z.number().nullable().optional(),
  spi: z.number().nullable().optional(),
})

export const phaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  order: z.number().int(),
})

export const sprintSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  goal: z.string().nullable().optional(),
  startDate: isoDate,
  endDate: isoDate,
  status: projectStatusEnum,
})

export const boardColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  order: z.number().int(),
  wipLimit: z.number().int().nullable().optional(),
})

export const taskSchema = z.object({
  id: z.string().min(1),
  mnemonic: z.string().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  type: taskTypeEnum,
  status: taskStatusEnum,
  priority: priorityEnum,
  parentId: z.string().nullable().optional(),
  phaseId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  columnId: z.string().nullable().optional(),
  assigneeEmail: z.string().email().nullable().optional(),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  progress: z.number().int().min(0).max(100),
  isMilestone: z.boolean(),
  slaResponseLimit: optionalIsoDate,
  slaResolutionLimit: optionalIsoDate,
  isEscalated: z.boolean(),
  plannedValue: z.number().nullable().optional(),
  actualCost: z.number().nullable().optional(),
  earnedValue: z.number().nullable().optional(),
  position: z.number(),
  archivedAt: optionalIsoDate,
  tags: z.array(z.string()).default([]),
  referenceUrl: z.string().nullable().optional(),
})

export const dependencySchema = z.object({
  id: z.string().min(1),
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: dependencyTypeEnum,
  lagDays: z.number().int(),
})

export const baselineSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  label: z.string().nullable().optional(),
  snapshotData: z.unknown(),
  createdAt: isoDate,
})

export const commentSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  content: z.string(),
  isInternal: z.boolean(),
  authorEmail: z.string().email().nullable().optional(),
  createdAt: isoDate,
})

export const attachmentSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  filename: z.string(),
  url: z.string(),
  size: z.number().int().nullable().optional(),
  mimetype: z.string().nullable().optional(),
  uploaderEmail: z.string().email().nullable().optional(),
  createdAt: isoDate,
})

export const customFieldDefSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string(),
  type: customFieldTypeEnum,
  required: z.boolean(),
  defaultValue: z.unknown().nullable().optional(),
  options: z.unknown().nullable().optional(),
  position: z.number(),
})

export const customFieldValueSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  taskId: z.string().min(1),
  value: z.unknown(),
})

export const mindMapSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable().optional(),
  ownerEmail: z.string().email().nullable().optional(),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      note: z.string().nullable().optional(),
      x: z.number(),
      y: z.number(),
      color: z.string().nullable().optional(),
      isRoot: z.boolean(),
      taskId: z.string().nullable().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      targetId: z.string().min(1),
      label: z.string().nullable().optional(),
    }),
  ),
})

/**
 * Time entries · placeholder shape.
 *
 * El modelo `TimeEntry` aún no existe en el schema de Prisma (P3 lo
 * incorpora en otra rama). El export emite siempre `[]` y el import lo
 * tolera vacío para no romper backups generados hoy y consumidos cuando
 * el modelo exista. Si el shape cambia se incrementa `schemaVersion`.
 */
export const timeEntrySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  userEmail: z.string().email().nullable().optional(),
  hours: z.number(),
  date: isoDate,
  note: z.string().nullable().optional(),
})

// ───────────────────────── Manifest root ─────────────────────────

export const manifestSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  exportedAt: isoDate,
  /** Información ligera del export para auditoría. */
  source: z
    .object({
      app: z.string().default('FollowupGantt'),
      exporterVersion: z.string().default('1.0.0'),
    })
    .default({ app: 'FollowupGantt', exporterVersion: '1.0.0' }),
  project: projectSchema,
  phases: z.array(phaseSchema).default([]),
  sprints: z.array(sprintSchema).default([]),
  columns: z.array(boardColumnSchema).default([]),
  tasks: z.array(taskSchema).default([]),
  dependencies: z.array(dependencySchema).default([]),
  baselines: z.array(baselineSchema).default([]),
  comments: z.array(commentSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
  customFieldDefs: z.array(customFieldDefSchema).default([]),
  customFieldValues: z.array(customFieldValueSchema).default([]),
  mindMaps: z.array(mindMapSchema).default([]),
  timeEntries: z.array(timeEntrySchema).default([]),
})

export type Manifest = z.infer<typeof manifestSchema>
export type ManifestProject = z.infer<typeof projectSchema>
export type ManifestTask = z.infer<typeof taskSchema>
export type ManifestDependency = z.infer<typeof dependencySchema>
export type ManifestBaseline = z.infer<typeof baselineSchema>
export type ManifestComment = z.infer<typeof commentSchema>
export type ManifestAttachment = z.infer<typeof attachmentSchema>
export type ManifestCustomFieldDef = z.infer<typeof customFieldDefSchema>
export type ManifestCustomFieldValue = z.infer<typeof customFieldValueSchema>
export type ManifestMindMap = z.infer<typeof mindMapSchema>
export type ManifestPhase = z.infer<typeof phaseSchema>
export type ManifestSprint = z.infer<typeof sprintSchema>
export type ManifestBoardColumn = z.infer<typeof boardColumnSchema>
export type ManifestTimeEntry = z.infer<typeof timeEntrySchema>

/**
 * Devuelve true si el `schemaVersion` recibido es soportado por este
 * importador. El caller debe lanzar `[MANIFEST_VERSION]` cuando false.
 */
export function isSupportedSchemaVersion(version: unknown): boolean {
  return (
    typeof version === 'number' &&
    (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(version)
  )
}
