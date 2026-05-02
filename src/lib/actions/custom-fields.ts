'use server'

/**
 * Ola P1 · Equipo 3 — Custom Fields configurables por proyecto.
 *
 * Permite definir campos personalizados sobre `Task` (texto, número, fecha,
 * select, multi-select, booleano, URL) parametrizados por proyecto y guardar
 * sus valores por tarea.
 *
 * Convenciones del repo aplicadas aquí:
 *   - Errores tipados `[CODE] detalle` (códigos: `INVALID_FIELD_TYPE`,
 *     `FIELD_KEY_DUPLICATE`, `FIELD_VALUE_INVALID`, `INVALID_INPUT`,
 *     `NOT_FOUND`).
 *   - Validación con zod, despacho del shape de `value` por `field.type`.
 *   - `revalidatePath` para refrescar listas/drawer tras mutaciones.
 *
 * Decisiones autónomas (documentadas para revisión):
 *   D-CF-1: la lectura `getFieldDefsForProject` usa `unstable_cache` por
 *           proyecto con tag invalidable `cf:defs:<projectId>`. Las
 *           mutaciones invalidan el tag además de `revalidatePath`. Esto
 *           ahorra round-trips cuando varias tareas del mismo proyecto
 *           cargan sus definiciones a la vez.
 *   D-CF-2: `position` se asigna como `max(position)+1` al crear, evitando
 *           reescribir todos los registros y dejando hueco para drag-handle.
 *   D-CF-3: `MULTI_SELECT` y `SELECT` requieren `options` no vacíos. Si
 *           faltan, el server action lanza `[INVALID_FIELD_TYPE]`.
 *   D-CF-4: `clearTaskFieldValue` es idempotente — si no existe la fila,
 *           no lanza (alineado con `deleteDependency`).
 */

import { z } from 'zod'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import type {
  CustomFieldDef,
  CustomFieldType,
  CustomFieldValue,
} from '@prisma/client'
import prisma from '@/lib/prisma'

// ─────────────────────────── Errores tipados ───────────────────────────
//
// Convención del repo: `[CODE] detalle legible`. El cliente parsea el código
// con regex y mapea a UX (toast). Los códigos NO son user-facing, el detalle
// sí. Mantengo paridad con `dependencies.ts` para consistencia.

export type CustomFieldErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_FIELD_TYPE'
  | 'FIELD_KEY_DUPLICATE'
  | 'FIELD_VALUE_INVALID'
  | 'NOT_FOUND'

function actionError(code: CustomFieldErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ──────────────────────────────────

// Slug "snake_case" o "lower-kebab" — caracteres válidos en URLs y exports
// MS Project / Excel sin escapar. Min 1 char para evitar string vacío post
// trim, max 64 para caber en headers de export.
const FIELD_KEY_SCHEMA = z
  .string()
  .trim()
  .min(1, 'La key del campo es obligatoria')
  .max(64, 'La key no puede exceder 64 caracteres')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'La key debe comenzar con minúscula y sólo contener letras, números o "_"',
  )

const FIELD_LABEL_SCHEMA = z
  .string()
  .trim()
  .min(1, 'La etiqueta es obligatoria')
  .max(120, 'La etiqueta no puede exceder 120 caracteres')

const FIELD_TYPE_SCHEMA = z.enum([
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
  'URL',
])

// Cada opción de SELECT/MULTI_SELECT lleva `value` (estable, usado en BD)
// y `label` (mostrado al usuario). Reutilizamos zod aquí para validar tanto
// al crear como al actualizar la def.
const OPTION_SCHEMA = z.object({
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
})

const OPTIONS_SCHEMA = z.array(OPTION_SCHEMA).min(1, 'Debe haber al menos una opción')

const createFieldDefSchema = z
  .object({
    key: FIELD_KEY_SCHEMA,
    label: FIELD_LABEL_SCHEMA,
    type: FIELD_TYPE_SCHEMA,
    required: z.boolean().optional().default(false),
    defaultValue: z.unknown().optional(),
    options: OPTIONS_SCHEMA.optional(),
  })
  .refine(
    (v) => {
      const needsOptions = v.type === 'SELECT' || v.type === 'MULTI_SELECT'
      if (needsOptions) return Array.isArray(v.options) && v.options.length > 0
      // Para tipos no-select, options debe ser undefined o array vacío.
      return !v.options || v.options.length === 0
    },
    {
      message: 'Las opciones son obligatorias sólo para SELECT/MULTI_SELECT',
      // Anclamos el issue al path `options` para que el dispatcher de
      // errores en `createFieldDef` lo mapee a `[INVALID_FIELD_TYPE]`.
      path: ['options'],
    },
  )

export type CreateFieldDefInput = z.input<typeof createFieldDefSchema>

const updateFieldDefSchema = z
  .object({
    key: FIELD_KEY_SCHEMA.optional(),
    label: FIELD_LABEL_SCHEMA.optional(),
    type: FIELD_TYPE_SCHEMA.optional(),
    required: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    options: OPTIONS_SCHEMA.optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateFieldDefInput = z.input<typeof updateFieldDefSchema>

// ─────────────────────────── Helpers ──────────────────────────────────

/**
 * Despacha la validación de `value` según el tipo del campo. Devuelve el
 * valor "saneado" (trim para strings, número JS para NUMBER, ISO `Date`
 * para DATE) listo para serializarse a JSON.
 *
 * Lanza `[FIELD_VALUE_INVALID]` con detalle legible si no encaja.
 */
function validateValueForType(
  type: CustomFieldType,
  rawValue: unknown,
  options: unknown,
): unknown {
  switch (type) {
    case 'TEXT': {
      if (typeof rawValue !== 'string') {
        actionError('FIELD_VALUE_INVALID', 'Se esperaba un texto')
      }
      return rawValue.trim()
    }
    case 'NUMBER': {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        actionError('FIELD_VALUE_INVALID', 'Se esperaba un número finito')
      }
      return rawValue
    }
    case 'BOOLEAN': {
      if (typeof rawValue !== 'boolean') {
        actionError('FIELD_VALUE_INVALID', 'Se esperaba true/false')
      }
      return rawValue
    }
    case 'DATE': {
      // Aceptamos string ISO (input type="date" del navegador) o Date.
      // Almacenamos siempre el string ISO YYYY-MM-DD para mantener el JSON
      // determinista entre cliente y servidor.
      if (rawValue instanceof Date) {
        if (Number.isNaN(rawValue.getTime())) {
          actionError('FIELD_VALUE_INVALID', 'Fecha inválida')
        }
        return rawValue.toISOString().slice(0, 10)
      }
      if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          actionError(
            'FIELD_VALUE_INVALID',
            'Fecha debe estar en formato YYYY-MM-DD',
          )
        }
        const ts = Date.parse(trimmed)
        if (Number.isNaN(ts)) {
          actionError('FIELD_VALUE_INVALID', 'Fecha inválida')
        }
        return trimmed
      }
      actionError('FIELD_VALUE_INVALID', 'Se esperaba una fecha')
    }
    case 'URL': {
      if (typeof rawValue !== 'string') {
        actionError('FIELD_VALUE_INVALID', 'Se esperaba una URL')
      }
      const trimmed = rawValue.trim()
      try {
        const u = new URL(trimmed)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          actionError('FIELD_VALUE_INVALID', 'La URL debe usar http o https')
        }
      } catch {
        actionError('FIELD_VALUE_INVALID', 'URL malformada')
      }
      return trimmed
    }
    case 'SELECT': {
      if (typeof rawValue !== 'string') {
        actionError('FIELD_VALUE_INVALID', 'Se esperaba un valor de la lista')
      }
      const allowed = parseOptionValues(options)
      if (!allowed.includes(rawValue)) {
        actionError(
          'FIELD_VALUE_INVALID',
          `Valor "${rawValue}" no está en las opciones definidas`,
        )
      }
      return rawValue
    }
    case 'MULTI_SELECT': {
      if (
        !Array.isArray(rawValue) ||
        rawValue.some((v) => typeof v !== 'string')
      ) {
        actionError('FIELD_VALUE_INVALID', 'Se esperaba un array de strings')
      }
      const allowed = new Set(parseOptionValues(options))
      const values = rawValue as string[]
      const bad = values.filter((v) => !allowed.has(v))
      if (bad.length > 0) {
        actionError(
          'FIELD_VALUE_INVALID',
          `Valores fuera de opciones: ${bad.join(', ')}`,
        )
      }
      // Deduplicamos preservando orden de inserción.
      return Array.from(new Set(values))
    }
    default: {
      actionError('INVALID_FIELD_TYPE', `Tipo desconocido: ${String(type)}`)
    }
  }
}

function parseOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options
    .map((o) => (o && typeof o === 'object' && 'value' in o ? (o as { value: unknown }).value : null))
    .filter((v): v is string => typeof v === 'string')
}

// ─────────────────────────── Lectura cacheada ─────────────────────────

const cfDefsTag = (projectId: string) => `cf:defs:${projectId}`

/**
 * Lista las definiciones de Custom Fields del proyecto, ordenadas por
 * `position` ascendente. Cacheado por proyecto con tag invalidable
 * (`cf:defs:<projectId>`) — las mutaciones llaman `revalidateTag`.
 */
export async function getFieldDefsForProject(
  projectId: string,
): Promise<CustomFieldDef[]> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')
  const loader = unstable_cache(
    async () =>
      prisma.customFieldDef.findMany({
        where: { projectId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
    ['custom-fields', 'defs', projectId],
    { tags: [cfDefsTag(projectId)] },
  )
  return loader()
}

/**
 * Lee los valores de Custom Fields para una tarea concreta. NO se cachea
 * porque la cardinalidad es alta (una entrada por (taskId,fieldId)) y los
 * autosaves del drawer requerirían invalidar tras cada blur.
 */
export async function getTaskFieldValues(
  taskId: string,
): Promise<CustomFieldValue[]> {
  if (!taskId) actionError('INVALID_INPUT', 'taskId requerido')
  return prisma.customFieldValue.findMany({
    where: { taskId },
    orderBy: { id: 'asc' },
  })
}

// ─────────────────────────── Mutaciones de definición ─────────────────

/**
 * Crea una nueva definición de Custom Field para `projectId`. Validaciones:
 *  1. zod sobre `def` (key snake_case, label, type, options según tipo).
 *  2. proyecto existe → `[NOT_FOUND]`.
 *  3. (projectId, key) único → `[FIELD_KEY_DUPLICATE]`.
 *  4. SELECT/MULTI_SELECT exigen `options` (D-CF-3).
 *
 * `position` se asigna como `max(position)+1` (D-CF-2).
 */
export async function createFieldDef(
  projectId: string,
  def: CreateFieldDefInput,
): Promise<CustomFieldDef> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')

  const parsed = createFieldDefSchema.safeParse(def)
  if (!parsed.success) {
    const issues = parsed.error.issues
    // Distinguimos errores específicos para mejor UX.
    const typeIssue = issues.find((i) => i.path[0] === 'type')
    if (typeIssue) {
      actionError('INVALID_FIELD_TYPE', typeIssue.message)
    }
    const optionsIssue = issues.find((i) => i.path[0] === 'options')
    if (optionsIssue) {
      actionError('INVALID_FIELD_TYPE', optionsIssue.message)
    }
    actionError('INVALID_INPUT', issues.map((i) => i.message).join('; '))
  }
  const { key, label, type, required, defaultValue, options } = parsed.data

  // Verifica existencia del proyecto antes de tocar la tabla.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) actionError('NOT_FOUND', 'Proyecto inexistente')

  // Unicidad de (projectId, key).
  const existing = await prisma.customFieldDef.findUnique({
    where: { projectId_key: { projectId, key } },
    select: { id: true },
  })
  if (existing) {
    actionError(
      'FIELD_KEY_DUPLICATE',
      `Ya existe un campo con la key "${key}" en este proyecto`,
    )
  }

  // Position incremental (D-CF-2). Si no hay registros, parte en 1.
  const last = await prisma.customFieldDef.findFirst({
    where: { projectId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPosition = (last?.position ?? 0) + 1

  const created = await prisma.customFieldDef.create({
    data: {
      projectId,
      key,
      label,
      type,
      required: required ?? false,
      defaultValue:
        defaultValue === undefined
          ? Prisma.JsonNull
          : (defaultValue as Prisma.InputJsonValue),
      options:
        options === undefined ? Prisma.JsonNull : (options as Prisma.InputJsonValue),
      position: nextPosition,
    },
  })

  // Next 16: `revalidateTag(tag, profile)` requiere el 2º argumento.
  // Usamos 'max' como en el resto del repo (baselines, scheduling).
  revalidateTag(cfDefsTag(projectId), 'max')
  revalidatePath(`/projects/${projectId}/fields`)
  return created
}

/**
 * Actualiza parcialmente una definición. Si se cambia `type` y el nuevo
 * tipo es SELECT/MULTI_SELECT pero no se proveen `options`, lanza
 * `[INVALID_FIELD_TYPE]` (validación combinada con el estado actual).
 */
export async function updateFieldDef(
  id: string,
  patch: UpdateFieldDefInput,
): Promise<CustomFieldDef> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')

  const parsed = updateFieldDefSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const existing = await prisma.customFieldDef.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      key: true,
      type: true,
      options: true,
    },
  })
  if (!existing) actionError('NOT_FOUND', 'Campo personalizado inexistente')

  const next = parsed.data
  const nextType = (next.type ?? existing.type) as CustomFieldType
  const nextOptions = next.options ?? (existing.options as unknown as
    | { value: string; label: string }[]
    | null)

  // Validación cruzada tipo ↔ options.
  const needsOptions = nextType === 'SELECT' || nextType === 'MULTI_SELECT'
  if (needsOptions && (!Array.isArray(nextOptions) || nextOptions.length === 0)) {
    actionError(
      'INVALID_FIELD_TYPE',
      `El tipo ${nextType} requiere al menos una opción`,
    )
  }
  if (!needsOptions && next.options !== undefined && next.options.length > 0) {
    actionError(
      'INVALID_FIELD_TYPE',
      'Las opciones sólo aplican a SELECT/MULTI_SELECT',
    )
  }

  // Si se cambia la key, validar unicidad sobre el mismo proyecto.
  if (next.key !== undefined && next.key !== existing.key) {
    const dup = await prisma.customFieldDef.findUnique({
      where: { projectId_key: { projectId: existing.projectId, key: next.key } },
      select: { id: true },
    })
    if (dup) {
      actionError(
        'FIELD_KEY_DUPLICATE',
        `Ya existe un campo con la key "${next.key}" en este proyecto`,
      )
    }
  }

  const data: Prisma.CustomFieldDefUpdateInput = {}
  if (next.key !== undefined) data.key = next.key
  if (next.label !== undefined) data.label = next.label
  if (next.type !== undefined) data.type = next.type
  if (next.required !== undefined) data.required = next.required
  if (next.defaultValue !== undefined) {
    data.defaultValue = next.defaultValue as Prisma.InputJsonValue
  }
  if (next.options !== undefined) {
    data.options = next.options as Prisma.InputJsonValue
  }
  if (next.position !== undefined) data.position = next.position

  const updated = await prisma.customFieldDef.update({ where: { id }, data })

  revalidateTag(cfDefsTag(existing.projectId), 'max')
  revalidatePath(`/projects/${existing.projectId}/fields`)
  return updated
}

/**
 * Borra una definición y, en cascada, todos sus valores (FK ON DELETE
 * CASCADE en BD). Idempotente: si ya no existe, no lanza.
 */
export async function deleteFieldDef(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')

  const existing = await prisma.customFieldDef.findUnique({
    where: { id },
    select: { projectId: true },
  })
  if (!existing) return

  await prisma.customFieldDef.delete({ where: { id } })

  revalidateTag(cfDefsTag(existing.projectId), 'max')
  revalidatePath(`/projects/${existing.projectId}/fields`)
}

// ─────────────────────────── Mutaciones de valor ──────────────────────

/**
 * Upsert del valor de un Custom Field para una tarea. Validaciones:
 *   1. La definición existe → `[NOT_FOUND]`.
 *   2. La tarea existe y pertenece al mismo proyecto que la def →
 *      `[FIELD_VALUE_INVALID]` (cross-project no soportado).
 *   3. `value` valida según `field.type` → `[FIELD_VALUE_INVALID]`.
 */
export async function setTaskFieldValue(
  taskId: string,
  fieldId: string,
  value: unknown,
): Promise<CustomFieldValue> {
  if (!taskId) actionError('INVALID_INPUT', 'taskId requerido')
  if (!fieldId) actionError('INVALID_INPUT', 'fieldId requerido')

  const [field, task] = await Promise.all([
    prisma.customFieldDef.findUnique({
      where: { id: fieldId },
      select: { id: true, projectId: true, type: true, options: true, required: true },
    }),
    prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    }),
  ])
  if (!field) actionError('NOT_FOUND', 'Campo personalizado inexistente')
  if (!task) actionError('NOT_FOUND', 'Tarea inexistente')

  if (field.projectId !== task.projectId) {
    actionError(
      'FIELD_VALUE_INVALID',
      'La tarea no pertenece al proyecto del campo',
    )
  }

  // Despacho por tipo. `validateValueForType` lanza `[FIELD_VALUE_INVALID]`
  // si `value` no encaja con la definición.
  const sanitized = validateValueForType(field.type, value, field.options)

  // En `required=true` rechazamos null/undefined/string vacío. Para
  // MULTI_SELECT exigimos al menos una opción seleccionada.
  if (field.required) {
    const isEmpty =
      sanitized === null ||
      sanitized === undefined ||
      sanitized === '' ||
      (Array.isArray(sanitized) && sanitized.length === 0)
    if (isEmpty) {
      actionError('FIELD_VALUE_INVALID', 'El campo es obligatorio')
    }
  }

  const upserted = await prisma.customFieldValue.upsert({
    where: { fieldId_taskId: { fieldId, taskId } },
    create: {
      fieldId,
      taskId,
      value: sanitized as Prisma.InputJsonValue,
    },
    update: { value: sanitized as Prisma.InputJsonValue },
  })

  revalidatePath(`/projects/${field.projectId}/fields`)
  return upserted
}

/**
 * Borra el valor de un Custom Field para una tarea. Idempotente.
 */
export async function clearTaskFieldValue(
  taskId: string,
  fieldId: string,
): Promise<void> {
  if (!taskId) actionError('INVALID_INPUT', 'taskId requerido')
  if (!fieldId) actionError('INVALID_INPUT', 'fieldId requerido')

  // `deleteMany` no lanza si no hay coincidencias (D-CF-4).
  await prisma.customFieldValue.deleteMany({ where: { taskId, fieldId } })

  // Conocer el projectId requeriría una query extra; revalidamos la ruta
  // genérica de tareas para refrescar drawers visibles.
  revalidatePath('/projects')
}
