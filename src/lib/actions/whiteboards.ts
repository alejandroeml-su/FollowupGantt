'use server'

/**
 * Ola P5 · Equipo P5-1 — Server Actions del módulo Whiteboards.
 *
 * Convenciones del repo aplicadas aquí:
 *   - Errores tipados `[CODE] detalle` (códigos: INVALID_INPUT, NOT_FOUND,
 *     FORBIDDEN, UNAUTHORIZED).
 *   - `unstable_cache` con tag `whiteboards` (perfil 'max') para listas;
 *     mutaciones invalidan con `revalidateTag('whiteboards', 'max')`.
 *   - Auth: `requireUser` para todas las operaciones; `requireProjectAccess`
 *     cuando la pizarra está vinculada a un proyecto.
 *
 * Decisiones autónomas (P5-1):
 *   D-WBA-1: `updateWhiteboardElements` recibe un array de patches geométricos
 *            (sin `data`) para que el autosave debounced no transfiera todo
 *            el JSON cada 500ms. Cuando el usuario edita el contenido del
 *            sticky usamos `setElementData` (carga puntual).
 *   D-WBA-2: `createElement` calcula `zIndex = max(zIndex)+1` para que el
 *            elemento nuevo siempre quede arriba; `bringToFront` reasigna
 *            según ese mismo principio.
 *   D-WBA-3: `archiveWhiteboard` usa soft-delete (`isArchived=true`) y se
 *            puede restaurar con `restoreWhiteboard`. Sólo `deleteWhiteboard`
 *            (irreversible) hace borrado físico — reservado para cleanup.
 */

import { z } from 'zod'
import { Prisma, type Whiteboard, type WhiteboardElement as PrismaWhiteboardElement } from '@prisma/client'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser, requireProjectAccess } from '@/lib/auth'
import type {
  WhiteboardElementTypeLiteral,
  WhiteboardListItem,
} from '@/lib/whiteboards/types'
import {
  elementPositionPatchSchema,
  elementTypeSchema,
  titleSchema,
  validateElementData,
  type ElementPositionPatch,
} from '@/lib/whiteboards/validators'

// ─────────────────────────── Errores tipados ───────────────────────────

export type WhiteboardErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'

function actionError(code: WhiteboardErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const WHITEBOARDS_TAG = 'whiteboards'

function invalidate() {
  revalidateTag(WHITEBOARDS_TAG, 'max')
}

// ─────────────────────────── Schemas ──────────────────────────────────

const createWhiteboardSchema = z.object({
  title: titleSchema,
  description: z.string().trim().max(500).optional().nullable(),
  projectId: z.string().min(1).optional().nullable(),
})

export type CreateWhiteboardInput = z.input<typeof createWhiteboardSchema>

const updateWhiteboardSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateWhiteboardInput = z.input<typeof updateWhiteboardSchema>

const createElementSchema = z.object({
  whiteboardId: z.string().min(1),
  type: elementTypeSchema,
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
  width: z.number().finite().min(1).max(10000).default(160),
  height: z.number().finite().min(1).max(10000).default(120),
  rotation: z.number().finite().default(0),
  data: z.unknown(), // validado por validateElementData
})

export type CreateElementInput = z.input<typeof createElementSchema>

// ─────────────────────────── Helpers ──────────────────────────────────

async function loadWhiteboardForAccess(id: string): Promise<{
  id: string
  title: string
  projectId: string | null
  createdById: string | null
}> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const wb = await prisma.whiteboard.findUnique({
    where: { id },
    select: { id: true, title: true, projectId: true, createdById: true },
  })
  if (!wb) actionError('NOT_FOUND', `Pizarra ${id} no existe`)
  return wb
}

async function ensureAccess(wb: {
  projectId: string | null
  createdById: string | null
}): Promise<{ userId: string }> {
  if (wb.projectId) {
    const user = await requireProjectAccess(wb.projectId)
    return { userId: user.id }
  }
  const user = await requireUser()
  return { userId: user.id }
}

// ─────────────────────────── Lecturas ─────────────────────────────────

/**
 * Lista las pizarras visibles para el usuario actual. En MVP no hay
 * tenancy multi-org, así que devolvemos todas las no archivadas + las
 * creadas por el usuario incluso si están archivadas (para "papelera").
 */
export async function getWhiteboardList(): Promise<WhiteboardListItem[]> {
  const user = await requireUser()
  const loader = unstable_cache(
    async (uid: string) => {
      const rows = await prisma.whiteboard.findMany({
        where: {
          OR: [{ isArchived: false }, { createdById: uid }],
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          _count: { select: { elements: true } },
        },
      })
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        projectId: r.projectId,
        projectName: r.project?.name ?? null,
        createdByName: r.createdBy?.name ?? null,
        elementCount: r._count.elements,
        isArchived: r.isArchived,
        updatedAt: r.updatedAt.toISOString(),
      }))
    },
    ['whiteboards', 'list', user.id],
    { tags: [WHITEBOARDS_TAG] },
  )
  return loader(user.id)
}

/**
 * Carga una pizarra completa con elementos. Aplica check de proyecto
 * cuando hay `projectId`.
 */
export async function getWhiteboardById(id: string): Promise<{
  whiteboard: Whiteboard
  elements: PrismaWhiteboardElement[]
}> {
  const meta = await loadWhiteboardForAccess(id)
  await ensureAccess(meta)

  const [wb, elements] = await Promise.all([
    prisma.whiteboard.findUnique({ where: { id } }),
    prisma.whiteboardElement.findMany({
      where: { whiteboardId: id },
      orderBy: { zIndex: 'asc' },
    }),
  ])
  if (!wb) actionError('NOT_FOUND', `Pizarra ${id} no existe`)
  return { whiteboard: wb, elements }
}

// ─────────────────────────── Mutaciones · Whiteboard ──────────────────

export async function createWhiteboard(
  input: CreateWhiteboardInput,
): Promise<Whiteboard> {
  const parsed = createWhiteboardSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  let userId: string
  if (data.projectId) {
    const user = await requireProjectAccess(data.projectId)
    userId = user.id
  } else {
    const user = await requireUser()
    userId = user.id
  }

  const wb = await prisma.whiteboard.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      projectId: data.projectId ?? null,
      createdById: userId,
    },
  })

  invalidate()
  revalidatePath('/whiteboards')
  return wb
}

export async function updateWhiteboard(
  id: string,
  patch: UpdateWhiteboardInput,
): Promise<Whiteboard> {
  const parsed = updateWhiteboardSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const meta = await loadWhiteboardForAccess(id)
  await ensureAccess(meta)
  const next = parsed.data

  // Cuando se cambia projectId, hay que verificar acceso al nuevo proyecto.
  if (next.projectId !== undefined && next.projectId && next.projectId !== meta.projectId) {
    await requireProjectAccess(next.projectId)
  }

  const data: Prisma.WhiteboardUpdateInput = {}
  if (next.title !== undefined) data.title = next.title
  if (next.description !== undefined) data.description = next.description ?? null
  if (next.projectId !== undefined) {
    data.project = next.projectId
      ? { connect: { id: next.projectId } }
      : { disconnect: true }
  }

  const updated = await prisma.whiteboard.update({ where: { id }, data })

  invalidate()
  revalidatePath('/whiteboards')
  revalidatePath(`/whiteboards/${id}`)
  return updated
}

export async function archiveWhiteboard(id: string): Promise<void> {
  const meta = await loadWhiteboardForAccess(id)
  await ensureAccess(meta)
  await prisma.whiteboard.update({ where: { id }, data: { isArchived: true } })
  invalidate()
  revalidatePath('/whiteboards')
}

export async function restoreWhiteboard(id: string): Promise<void> {
  const meta = await loadWhiteboardForAccess(id)
  await ensureAccess(meta)
  await prisma.whiteboard.update({ where: { id }, data: { isArchived: false } })
  invalidate()
  revalidatePath('/whiteboards')
}

export async function deleteWhiteboard(id: string): Promise<void> {
  const meta = await loadWhiteboardForAccess(id)
  await ensureAccess(meta)
  await prisma.whiteboard.delete({ where: { id } })
  invalidate()
  revalidatePath('/whiteboards')
}

// ─────────────────────────── Mutaciones · Elements ───────────────────

export async function createElement(
  input: CreateElementInput,
): Promise<PrismaWhiteboardElement> {
  const parsed = createElementSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const meta = await loadWhiteboardForAccess(data.whiteboardId)
  await ensureAccess(meta)

  // Validate JSON payload by type (D-WB-1).
  const validatedData = validateElementData(
    data.type as WhiteboardElementTypeLiteral,
    data.data,
  )

  // zIndex incremental (D-WBA-2).
  const top = await prisma.whiteboardElement.findFirst({
    where: { whiteboardId: data.whiteboardId },
    orderBy: { zIndex: 'desc' },
    select: { zIndex: true },
  })
  const nextZ = (top?.zIndex ?? 0) + 1

  const created = await prisma.whiteboardElement.create({
    data: {
      whiteboardId: data.whiteboardId,
      type: data.type,
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
      rotation: data.rotation,
      zIndex: nextZ,
      data: validatedData as unknown as Prisma.InputJsonValue,
    },
  })

  // Touch parent updatedAt para que la lista refleje "última edición".
  await prisma.whiteboard.update({
    where: { id: data.whiteboardId },
    data: { updatedAt: new Date() },
  })

  invalidate()
  revalidatePath(`/whiteboards/${data.whiteboardId}`)
  return created
}

/**
 * Autosave debounced (500ms) — recibe un batch de patches geométricos
 * y los aplica en una transacción. No valida `data` (eso lo hace
 * `setElementData`).
 */
export async function updateWhiteboardElements(
  whiteboardId: string,
  patches: ElementPositionPatch[],
): Promise<void> {
  if (!whiteboardId) actionError('INVALID_INPUT', 'whiteboardId requerido')
  if (!Array.isArray(patches) || patches.length === 0) return
  if (patches.length > 500) {
    actionError('INVALID_INPUT', 'Demasiados patches (máx 500)')
  }

  // Valida cada patch con zod.
  const validated: ElementPositionPatch[] = []
  for (const p of patches) {
    const parsed = elementPositionPatchSchema.safeParse(p)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        `Patch inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    validated.push(parsed.data)
  }

  const meta = await loadWhiteboardForAccess(whiteboardId)
  await ensureAccess(meta)

  await prisma.$transaction(
    validated.map((p) => {
      const data: Prisma.WhiteboardElementUpdateInput = {}
      if (p.x !== undefined) data.x = p.x
      if (p.y !== undefined) data.y = p.y
      if (p.width !== undefined) data.width = p.width
      if (p.height !== undefined) data.height = p.height
      if (p.rotation !== undefined) data.rotation = p.rotation
      if (p.zIndex !== undefined) data.zIndex = p.zIndex
      return prisma.whiteboardElement.update({
        where: { id: p.id },
        data,
      })
    }),
  )

  invalidate()
}

/**
 * Actualiza el payload `data` de un elemento (cambio de texto, color,
 * variante de shape…). Valida con `validateElementData`.
 */
export async function setElementData(
  elementId: string,
  rawData: unknown,
): Promise<PrismaWhiteboardElement> {
  if (!elementId) actionError('INVALID_INPUT', 'elementId requerido')

  const el = await prisma.whiteboardElement.findUnique({
    where: { id: elementId },
    select: { id: true, whiteboardId: true, type: true },
  })
  if (!el) actionError('NOT_FOUND', `Elemento ${elementId} no existe`)

  const meta = await loadWhiteboardForAccess(el.whiteboardId)
  await ensureAccess(meta)

  const validated = validateElementData(
    el.type as WhiteboardElementTypeLiteral,
    rawData,
  )

  const updated = await prisma.whiteboardElement.update({
    where: { id: elementId },
    data: { data: validated as unknown as Prisma.InputJsonValue },
  })

  invalidate()
  revalidatePath(`/whiteboards/${el.whiteboardId}`)
  return updated
}

export async function deleteElement(elementId: string): Promise<void> {
  if (!elementId) actionError('INVALID_INPUT', 'elementId requerido')

  const el = await prisma.whiteboardElement.findUnique({
    where: { id: elementId },
    select: { id: true, whiteboardId: true },
  })
  if (!el) actionError('NOT_FOUND', `Elemento ${elementId} no existe`)

  const meta = await loadWhiteboardForAccess(el.whiteboardId)
  await ensureAccess(meta)

  await prisma.whiteboardElement.delete({ where: { id: elementId } })

  invalidate()
  revalidatePath(`/whiteboards/${el.whiteboardId}`)
}

/**
 * Borra múltiples elementos de la misma pizarra. Útil para `Delete` con
 * selección múltiple.
 */
export async function deleteElements(
  whiteboardId: string,
  elementIds: string[],
): Promise<void> {
  if (!whiteboardId) actionError('INVALID_INPUT', 'whiteboardId requerido')
  if (!Array.isArray(elementIds) || elementIds.length === 0) return

  const meta = await loadWhiteboardForAccess(whiteboardId)
  await ensureAccess(meta)

  await prisma.whiteboardElement.deleteMany({
    where: { whiteboardId, id: { in: elementIds } },
  })

  invalidate()
  revalidatePath(`/whiteboards/${whiteboardId}`)
}
