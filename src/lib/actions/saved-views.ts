'use server'

/**
 * Ola P2 · Equipo P2-1 — Vistas guardadas + agrupación dinámica multi-surface.
 *
 * Persistencia de "vistas" (filtros + grouping + columnPrefs + sorting) por
 * usuario y superficie (LIST, KANBAN, GANTT, CALENDAR, TABLE). Equiparamos
 * paridad con ClickUp permitiendo reutilizar configuraciones, marcar una
 * default por superficie y compartir vistas con todos los usuarios.
 *
 * Convenciones del repo aplicadas aquí:
 *   - Errores tipados `[CODE] detalle` (códigos: VIEW_NOT_FOUND,
 *     VIEW_NAME_DUPLICATE, INVALID_SURFACE, INVALID_GROUPING, INVALID_INPUT,
 *     UNAUTHORIZED, FORBIDDEN).
 *   - `unstable_cache` con tag `views:<userId>:<surface>` para listas; las
 *     mutaciones invalidan con `revalidateTag(_, 'max')`.
 *   - Auth: usamos `requireUser` cuando la action es exclusiva del propietario
 *     (create/update/delete/setDefault). `getViewsForUser` y
 *     `getSharedViewsForOrg` también requieren sesión para evitar leakage
 *     accidental.
 *
 * Decisiones autónomas (documentadas para revisión):
 *   D-SV-1: La unicidad `1 default por usuario por surface` se mantiene en
 *           código (`setDefaultView` desmarca otras dentro de una transacción)
 *           en lugar de un índice parcial. Esto evita migraciones
 *           condicionales (`WHERE` en Postgres) y simplifica el rollback si
 *           una vista compartida muta visibilidad.
 *   D-SV-2: `position` se asigna como `max(position)+1` al crear (mismo patrón
 *           que `customFieldDef.position`). Reordenar = updateView({position}).
 *   D-SV-3: La validación del `grouping` se hace contra `GROUPING_KEYS` (lista
 *           cerrada) + el prefijo `custom_field:<id>` (UUID-shape ligero). No
 *           validamos contra la BD que el customFieldId exista — el helper
 *           `groupTasks` cae a "Sin agrupar" si el id no resuelve.
 *   D-SV-4: `getSharedViewsForOrg` devuelve TODAS las vistas con `isShared=true`
 *           del workspace (no hay tenancy multiproyecto en P2). Cuando llegue
 *           el modelo Org/Workspace, filtraremos por orgId aquí.
 *   D-SV-5: `deleteView` es idempotente (no lanza si ya no existe), alineado
 *           con `clearTaskFieldValue` y `deleteDependency`.
 */

import { z } from 'zod'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { Prisma, type SavedView, type ViewSurface } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth'

// ─────────────────────────── Errores tipados ───────────────────────────

export type SavedViewErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SURFACE'
  | 'INVALID_GROUPING'
  | 'VIEW_NOT_FOUND'
  | 'VIEW_NAME_DUPLICATE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'

function actionError(code: SavedViewErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Constantes ────────────────────────────────

export const VIEW_SURFACES = ['LIST', 'KANBAN', 'GANTT', 'CALENDAR', 'TABLE'] as const
export type ViewSurfaceLiteral = (typeof VIEW_SURFACES)[number]

/**
 * Lista cerrada de claves de grouping aceptadas (D-SV-3). El sufijo
 * `custom_field:<id>` se valida con regex aparte para no enumerar todos los
 * customFieldIds posibles.
 */
export const GROUPING_KEYS = [
  'assignee',
  'sprint',
  'phase',
  'status',
  'priority',
  'tags',
] as const

const CUSTOM_FIELD_GROUPING_RE = /^custom_field:[a-zA-Z0-9_-]{1,64}$/

export function isValidGrouping(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return true
  if ((GROUPING_KEYS as readonly string[]).includes(value)) return true
  return CUSTOM_FIELD_GROUPING_RE.test(value)
}

// ─────────────────────────── Schemas ──────────────────────────────────

const surfaceSchema = z.enum(VIEW_SURFACES)

const groupingSchema = z
  .string()
  .max(96, 'grouping demasiado largo')
  .nullable()
  .optional()
  .refine(
    (v) => v === null || v === undefined || isValidGrouping(v),
    { message: 'grouping inválido' },
  )

// Sorting: { field, direction }. `field` libre (mnemonic, title, priority…),
// `direction` cerrada a 'asc' | 'desc'.
const sortingSchema = z
  .object({
    field: z.string().min(1).max(64),
    direction: z.enum(['asc', 'desc']),
  })
  .nullable()
  .optional()

// columnPrefs y filters quedan como JSON libre tipado a record. La validación
// fuerte del shape de filters se delega a `taskFilters.ts` cuando la vista se
// aplica en el cliente; aquí evitamos acoplarnos a esa estructura.
const jsonRecordSchema = z.record(z.string(), z.unknown()).nullable().optional()

const NAME_SCHEMA = z
  .string()
  .trim()
  .min(1, 'El nombre es obligatorio')
  .max(120, 'El nombre no puede exceder 120 caracteres')

const createViewSchema = z.object({
  name: NAME_SCHEMA,
  surface: surfaceSchema,
  filters: z.record(z.string(), z.unknown()).default({}),
  grouping: groupingSchema,
  sorting: sortingSchema,
  columnPrefs: jsonRecordSchema,
  isShared: z.boolean().optional().default(false),
})

export type CreateViewInput = z.input<typeof createViewSchema>

const updateViewSchema = z
  .object({
    name: NAME_SCHEMA.optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    grouping: groupingSchema,
    sorting: sortingSchema,
    columnPrefs: jsonRecordSchema,
    isShared: z.boolean().optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateViewInput = z.input<typeof updateViewSchema>

// ─────────────────────────── Cache helpers ─────────────────────────────

const userViewsTag = (userId: string, surface: ViewSurface) =>
  `views:${userId}:${surface}`
const sharedViewsTag = (surface: ViewSurface) => `views:shared:${surface}`

function invalidateUserViews(userId: string, surface: ViewSurface) {
  revalidateTag(userViewsTag(userId, surface), 'max')
  revalidateTag(sharedViewsTag(surface), 'max')
}

// ─────────────────────────── Lectura ──────────────────────────────────

/**
 * Lista las vistas del usuario autenticado para una superficie. Cacheado por
 * tag invalidable (`views:<userId>:<surface>`); las mutaciones llaman
 * `revalidateTag`.
 */
export async function getViewsForUser(
  surface: ViewSurfaceLiteral,
): Promise<SavedView[]> {
  const parsed = surfaceSchema.safeParse(surface)
  if (!parsed.success) actionError('INVALID_SURFACE', `Surface inválida: ${surface}`)

  const user = await requireUser()
  const loader = unstable_cache(
    async (uid: string, srf: ViewSurface) => {
      return prisma.savedView.findMany({
        where: { userId: uid, surface: srf },
        orderBy: [
          { isDefault: 'desc' },
          { position: 'asc' },
          { createdAt: 'asc' },
        ],
      })
    },
    ['saved-views', 'user', user.id, parsed.data],
    { tags: [userViewsTag(user.id, parsed.data)] },
  )
  return loader(user.id, parsed.data)
}

/**
 * Lista las vistas compartidas (`isShared=true`) accesibles por el usuario
 * actual. En P2 no hay tenancy → devolvemos todas las del repositorio para la
 * superficie indicada, EXCLUYENDO las del propio usuario (esas ya las
 * trae `getViewsForUser`). El cliente puede mergear ambas listas.
 */
export async function getSharedViewsForOrg(
  surface: ViewSurfaceLiteral,
): Promise<SavedView[]> {
  const parsed = surfaceSchema.safeParse(surface)
  if (!parsed.success) actionError('INVALID_SURFACE', `Surface inválida: ${surface}`)

  const user = await requireUser()
  const loader = unstable_cache(
    async (srf: ViewSurface, uid: string) => {
      return prisma.savedView.findMany({
        where: { surface: srf, isShared: true, NOT: { userId: uid } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
    },
    ['saved-views', 'shared', parsed.data, user.id],
    { tags: [sharedViewsTag(parsed.data)] },
  )
  return loader(parsed.data, user.id)
}

// ─────────────────────────── Mutaciones ───────────────────────────────

/**
 * Crea una vista guardada para el usuario actual. Validaciones:
 *  1. zod sobre input (nombre, surface, filters, grouping, sorting…).
 *  2. Unicidad (userId, surface, name) → `[VIEW_NAME_DUPLICATE]`.
 *  3. `position` = `max(position)+1` dentro del scope (userId, surface).
 */
export async function createView(input: CreateViewInput): Promise<SavedView> {
  const parsed = createViewSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
    const groupingIssue = issues.find((i) => i.path[0] === 'grouping')
    if (groupingIssue) actionError('INVALID_GROUPING', groupingIssue.message)
    const surfaceIssue = issues.find((i) => i.path[0] === 'surface')
    if (surfaceIssue) actionError('INVALID_SURFACE', surfaceIssue.message)
    actionError('INVALID_INPUT', issues.map((i) => i.message).join('; '))
  }

  const user = await requireUser()
  const data = parsed.data

  // Unicidad por (userId, surface, name) — nombre case-sensitive trim.
  const dup = await prisma.savedView.findFirst({
    where: {
      userId: user.id,
      surface: data.surface,
      name: data.name,
    },
    select: { id: true },
  })
  if (dup) {
    actionError(
      'VIEW_NAME_DUPLICATE',
      `Ya existe una vista llamada "${data.name}" en esta superficie`,
    )
  }

  // Position incremental (D-SV-2).
  const last = await prisma.savedView.findFirst({
    where: { userId: user.id, surface: data.surface },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPosition = (last?.position ?? 0) + 1

  const created = await prisma.savedView.create({
    data: {
      userId: user.id,
      name: data.name,
      surface: data.surface,
      filters: (data.filters ?? {}) as Prisma.InputJsonValue,
      grouping: data.grouping ?? null,
      sorting:
        data.sorting === undefined || data.sorting === null
          ? Prisma.JsonNull
          : (data.sorting as Prisma.InputJsonValue),
      columnPrefs:
        data.columnPrefs === undefined || data.columnPrefs === null
          ? Prisma.JsonNull
          : (data.columnPrefs as Prisma.InputJsonValue),
      isShared: data.isShared ?? false,
      position: nextPosition,
    },
  })

  invalidateUserViews(user.id, data.surface)
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/calendar')
  revalidatePath('/table')
  return created
}

/**
 * Actualiza parcialmente una vista. Solo el owner puede editarla
 * (`[FORBIDDEN]` en caso contrario, incluso para vistas compartidas).
 */
export async function updateView(
  id: string,
  patch: UpdateViewInput,
): Promise<SavedView> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const parsed = updateViewSchema.safeParse(patch)
  if (!parsed.success) {
    const issues = parsed.error.issues
    const groupingIssue = issues.find((i) => i.path[0] === 'grouping')
    if (groupingIssue) actionError('INVALID_GROUPING', groupingIssue.message)
    actionError('INVALID_INPUT', issues.map((i) => i.message).join('; '))
  }

  const user = await requireUser()
  const existing = await prisma.savedView.findUnique({
    where: { id },
    select: { id: true, userId: true, surface: true, name: true },
  })
  if (!existing) actionError('VIEW_NOT_FOUND', 'Vista inexistente')
  if (existing.userId !== user.id) {
    actionError('FORBIDDEN', 'Solo el propietario puede editar esta vista')
  }

  const next = parsed.data
  // Si se renombra, validar unicidad.
  if (next.name !== undefined && next.name !== existing.name) {
    const dup = await prisma.savedView.findFirst({
      where: {
        userId: user.id,
        surface: existing.surface,
        name: next.name,
        NOT: { id },
      },
      select: { id: true },
    })
    if (dup) {
      actionError(
        'VIEW_NAME_DUPLICATE',
        `Ya existe una vista llamada "${next.name}" en esta superficie`,
      )
    }
  }

  const data: Prisma.SavedViewUpdateInput = {}
  if (next.name !== undefined) data.name = next.name
  if (next.filters !== undefined) {
    data.filters = next.filters as Prisma.InputJsonValue
  }
  if (next.grouping !== undefined) {
    data.grouping = next.grouping ?? null
  }
  if (next.sorting !== undefined) {
    data.sorting =
      next.sorting === null
        ? Prisma.JsonNull
        : (next.sorting as Prisma.InputJsonValue)
  }
  if (next.columnPrefs !== undefined) {
    data.columnPrefs =
      next.columnPrefs === null
        ? Prisma.JsonNull
        : (next.columnPrefs as Prisma.InputJsonValue)
  }
  if (next.isShared !== undefined) data.isShared = next.isShared
  if (next.position !== undefined) data.position = next.position

  const updated = await prisma.savedView.update({ where: { id }, data })

  invalidateUserViews(user.id, existing.surface)
  return updated
}

/**
 * Borra una vista (idempotente, D-SV-5). Solo el owner puede borrarla.
 */
export async function deleteView(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')

  const user = await requireUser()
  const existing = await prisma.savedView.findUnique({
    where: { id },
    select: { userId: true, surface: true },
  })
  if (!existing) return // idempotente
  if (existing.userId !== user.id) {
    actionError('FORBIDDEN', 'Solo el propietario puede eliminar esta vista')
  }

  await prisma.savedView.delete({ where: { id } })
  invalidateUserViews(user.id, existing.surface)
}

/**
 * Marca una vista como default para su superficie. Desmarca cualquier otra
 * default del mismo usuario en esa superficie (D-SV-1) dentro de una
 * transacción para garantizar atomicidad.
 */
export async function setDefaultView(
  viewId: string,
  surface: ViewSurfaceLiteral,
): Promise<SavedView> {
  if (!viewId) actionError('INVALID_INPUT', 'viewId requerido')
  const sParsed = surfaceSchema.safeParse(surface)
  if (!sParsed.success) actionError('INVALID_SURFACE', `Surface inválida: ${surface}`)

  const user = await requireUser()
  const existing = await prisma.savedView.findUnique({
    where: { id: viewId },
    select: { id: true, userId: true, surface: true },
  })
  if (!existing) actionError('VIEW_NOT_FOUND', 'Vista inexistente')
  if (existing.userId !== user.id) {
    actionError('FORBIDDEN', 'Solo el propietario puede marcar default')
  }
  if (existing.surface !== sParsed.data) {
    actionError(
      'INVALID_SURFACE',
      `La vista pertenece a ${existing.surface}, no a ${sParsed.data}`,
    )
  }

  const [, updated] = await prisma.$transaction([
    prisma.savedView.updateMany({
      where: {
        userId: user.id,
        surface: sParsed.data,
        isDefault: true,
        NOT: { id: viewId },
      },
      data: { isDefault: false },
    }),
    prisma.savedView.update({
      where: { id: viewId },
      data: { isDefault: true },
    }),
  ])

  invalidateUserViews(user.id, sParsed.data)
  return updated
}
