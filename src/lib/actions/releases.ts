'use server'

/**
 * Wave P9 · Agile Maturity (HU-9.4) — Server actions para Releases.
 *
 * Patrón:
 *   - Errores tipados [CODE].
 *   - revalidatePath en /releases + ProjectDetail tras cualquier mutación.
 *   - Validación cross-project: una Release sólo puede agrupar Epics o
 *     Sprints del mismo proyecto al que pertenece (defensa-en-profundidad).
 *   - scopeMode exclusivo: si scopeMode=EPIC, no permite addSprint y
 *     viceversa.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import type { ReleaseScopeMode } from '@prisma/client'

function revalidateReleaseViews(projectId?: string) {
  revalidatePath('/projects')
  if (projectId) {
    revalidatePath(`/projects/${projectId}/releases`)
    revalidatePath(`/projects/${projectId}`)
  }
}

export type CreateReleaseInput = {
  name: string
  version: string
  description?: string | null
  scopeMode?: ReleaseScopeMode
  plannedDate: string
  ownerId?: string | null
  projectId: string
}

export async function createRelease(input: CreateReleaseInput) {
  if (!input.name?.trim()) throw new Error('[INVALID_INPUT] name requerido')
  if (!input.version?.trim()) throw new Error('[INVALID_INPUT] version requerida')
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.plannedDate) throw new Error('[INVALID_INPUT] plannedDate requerida')

  const planned = new Date(input.plannedDate)
  if (Number.isNaN(planned.getTime())) {
    throw new Error('[INVALID_INPUT] plannedDate inválida')
  }

  const release = await prisma.release.create({
    data: {
      name: input.name.trim(),
      version: input.version.trim(),
      description: input.description?.trim() || null,
      scopeMode: input.scopeMode ?? 'EPIC',
      plannedDate: planned,
      ownerId: input.ownerId || null,
      projectId: input.projectId,
    },
  })

  await recordAuditEventSafe({
    action: 'release.created',
    entityType: 'release',
    entityId: release.id,
    after: { name: release.name, version: release.version, scopeMode: release.scopeMode },
  })

  revalidateReleaseViews(input.projectId)
  return release
}

export type UpdateReleaseInput = {
  id: string
  name?: string
  version?: string
  description?: string | null
  plannedDate?: string
  ownerId?: string | null
}

export async function updateRelease(input: UpdateReleaseInput) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.release.findUnique({
    where: { id: input.id },
    select: { projectId: true, name: true, version: true },
  })
  if (!before) throw new Error('[NOT_FOUND] release no existe')

  const data: Parameters<typeof prisma.release.update>[0]['data'] = {}
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('[INVALID_INPUT] name no puede ser vacío')
    data.name = input.name.trim()
  }
  if (input.version !== undefined) {
    if (!input.version.trim()) throw new Error('[INVALID_INPUT] version no puede ser vacía')
    data.version = input.version.trim()
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null
  }
  if (input.plannedDate !== undefined) {
    const d = new Date(input.plannedDate)
    if (Number.isNaN(d.getTime())) throw new Error('[INVALID_INPUT] plannedDate inválida')
    data.plannedDate = d
  }
  if (input.ownerId !== undefined) {
    data.ownerId = input.ownerId || null
  }

  const updated = await prisma.release.update({ where: { id: input.id }, data })

  await recordAuditEventSafe({
    action: 'release.updated',
    entityType: 'release',
    entityId: input.id,
    before,
    after: { name: updated.name, version: updated.version },
  })

  revalidateReleaseViews(before.projectId)
  return updated
}

/**
 * Marca una Release como liberada con la fecha indicada (o now()).
 * Idempotente: si ya está released, no-op silencioso.
 */
export async function markReleaseAsReleased(input: {
  id: string
  releasedDate?: string
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.release.findUnique({
    where: { id: input.id },
    select: { projectId: true, releasedDate: true, name: true },
  })
  if (!before) throw new Error('[NOT_FOUND] release no existe')
  if (before.releasedDate) return { ok: true, alreadyReleased: true }

  const released = input.releasedDate ? new Date(input.releasedDate) : new Date()
  if (Number.isNaN(released.getTime())) {
    throw new Error('[INVALID_INPUT] releasedDate inválida')
  }

  const updated = await prisma.release.update({
    where: { id: input.id },
    data: { releasedDate: released },
  })

  await recordAuditEventSafe({
    action: 'release.released',
    entityType: 'release',
    entityId: input.id,
    after: { releasedDate: released.toISOString() },
  })

  revalidateReleaseViews(before.projectId)
  return { ok: true, release: updated }
}

export async function archiveRelease(input: { id: string }) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.release.findUnique({
    where: { id: input.id },
    select: { projectId: true },
  })
  if (!before) throw new Error('[NOT_FOUND] release no existe')

  await prisma.release.update({
    where: { id: input.id },
    data: { archivedAt: new Date() },
  })

  await recordAuditEventSafe({
    action: 'release.archived',
    entityType: 'release',
    entityId: input.id,
  })

  revalidateReleaseViews(before.projectId)
  return { ok: true }
}

/**
 * Asigna o quita un Epic de una Release. Valida scopeMode=EPIC y que
 * el Epic pertenezca al mismo proyecto que la Release.
 */
export async function setReleaseEpics(input: {
  releaseId: string
  epicIds: string[]
}) {
  if (!input.releaseId) throw new Error('[INVALID_INPUT] releaseId requerido')

  const release = await prisma.release.findUnique({
    where: { id: input.releaseId },
    select: { projectId: true, scopeMode: true },
  })
  if (!release) throw new Error('[NOT_FOUND] release no existe')
  if (release.scopeMode !== 'EPIC') {
    throw new Error(
      '[INVALID_SCOPE] esta release agrupa Sprints, no se pueden añadir Epics',
    )
  }

  if (input.epicIds.length > 0) {
    const epics = await prisma.epic.findMany({
      where: { id: { in: input.epicIds } },
      select: { projectId: true },
    })
    if (epics.length !== input.epicIds.length) {
      throw new Error('[NOT_FOUND] alguna epic no existe')
    }
    const wrong = epics.filter((e) => e.projectId !== release.projectId)
    if (wrong.length > 0) {
      throw new Error(
        '[INVALID_ASSIGNMENT] alguna epic pertenece a otro proyecto',
      )
    }
  }

  // Estrategia: borrar todas y re-crear (más simple que diff).
  await prisma.$transaction([
    prisma.releaseEpic.deleteMany({ where: { releaseId: input.releaseId } }),
    ...input.epicIds.map((epicId, idx) =>
      prisma.releaseEpic.create({
        data: { releaseId: input.releaseId, epicId, position: idx },
      }),
    ),
  ])

  await recordAuditEventSafe({
    action: 'release.scope_updated',
    entityType: 'release',
    entityId: input.releaseId,
    after: { epicCount: input.epicIds.length },
  })

  revalidateReleaseViews(release.projectId)
  return { ok: true, count: input.epicIds.length }
}

/**
 * Asigna o quita Sprints de una Release. Valida scopeMode=SPRINT.
 */
export async function setReleaseSprints(input: {
  releaseId: string
  sprintIds: string[]
}) {
  if (!input.releaseId) throw new Error('[INVALID_INPUT] releaseId requerido')

  const release = await prisma.release.findUnique({
    where: { id: input.releaseId },
    select: { projectId: true, scopeMode: true },
  })
  if (!release) throw new Error('[NOT_FOUND] release no existe')
  if (release.scopeMode !== 'SPRINT') {
    throw new Error(
      '[INVALID_SCOPE] esta release agrupa Epics, no se pueden añadir Sprints',
    )
  }

  if (input.sprintIds.length > 0) {
    const sprints = await prisma.sprint.findMany({
      where: { id: { in: input.sprintIds } },
      select: { projectId: true },
    })
    if (sprints.length !== input.sprintIds.length) {
      throw new Error('[NOT_FOUND] algún sprint no existe')
    }
    const wrong = sprints.filter((s) => s.projectId !== release.projectId)
    if (wrong.length > 0) {
      throw new Error(
        '[INVALID_ASSIGNMENT] algún sprint pertenece a otro proyecto',
      )
    }
  }

  await prisma.$transaction([
    prisma.releaseSprint.deleteMany({ where: { releaseId: input.releaseId } }),
    ...input.sprintIds.map((sprintId, idx) =>
      prisma.releaseSprint.create({
        data: { releaseId: input.releaseId, sprintId, position: idx },
      }),
    ),
  ])

  await recordAuditEventSafe({
    action: 'release.scope_updated',
    entityType: 'release',
    entityId: input.releaseId,
    after: { sprintCount: input.sprintIds.length },
  })

  revalidateReleaseViews(release.projectId)
  return { ok: true, count: input.sprintIds.length }
}

/**
 * Carga las Releases activas (no archivadas) de un proyecto, con su scope
 * resuelto y % completado calculado en el server (rollup de epics o
 * sprints según scopeMode).
 *
 * Para epics: % = avg de Tasks DONE / Tasks total por Epic.
 * Para sprints: % = velocity actual / capacity (si capacity > 0), o
 * Tasks DONE / Total del sprint.
 */
export async function listReleasesForProject(projectId: string) {
  if (!projectId) return []

  const releases = await prisma.release.findMany({
    where: { projectId, archivedAt: null },
    include: {
      owner: { select: { id: true, name: true } },
      epics: {
        include: {
          epic: {
            select: {
              id: true,
              name: true,
              color: true,
              status: true,
              _count: { select: { tasks: { where: { archivedAt: null } } } },
            },
          },
        },
        orderBy: { position: 'asc' },
      },
      sprints: {
        include: {
          sprint: {
            select: {
              id: true,
              name: true,
              status: true,
              capacity: true,
              velocityActual: true,
              startDate: true,
              endDate: true,
            },
          },
        },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { plannedDate: 'asc' },
  })

  // Cómputo de progress por Release.
  // Para epics: por cada Epic asignada, contar Tasks DONE / Total
  // (con un round-trip extra agrupado).
  const epicIds = new Set<string>()
  for (const r of releases) {
    for (const re of r.epics) epicIds.add(re.epic.id)
  }

  let epicProgress: Record<string, number> = {}
  if (epicIds.size > 0) {
    const grouped = await prisma.task.groupBy({
      by: ['epicId', 'status'],
      where: { epicId: { in: [...epicIds] }, archivedAt: null },
      _count: { _all: true },
    })
    const totals: Record<string, { total: number; done: number }> = {}
    for (const row of grouped) {
      if (!row.epicId) continue
      const t = totals[row.epicId] ?? { total: 0, done: 0 }
      t.total += row._count._all
      if (row.status === 'DONE') t.done += row._count._all
      totals[row.epicId] = t
    }
    epicProgress = Object.fromEntries(
      Object.entries(totals).map(([id, { total, done }]) => [
        id,
        total > 0 ? Math.round((done / total) * 100) : 0,
      ]),
    )
  }

  return releases.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    description: r.description,
    scopeMode: r.scopeMode,
    plannedDate: r.plannedDate.toISOString(),
    releasedDate: r.releasedDate?.toISOString() ?? null,
    ownerId: r.ownerId,
    ownerName: r.owner?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    epics: r.epics.map((re) => ({
      id: re.epic.id,
      name: re.epic.name,
      color: re.epic.color,
      status: re.epic.status,
      taskCount: re.epic._count.tasks,
      progressPct: epicProgress[re.epic.id] ?? 0,
    })),
    sprints: r.sprints.map((rs) => {
      const cap = rs.sprint.capacity ?? 0
      const velocity = rs.sprint.velocityActual ?? 0
      return {
        id: rs.sprint.id,
        name: rs.sprint.name,
        status: rs.sprint.status,
        capacity: rs.sprint.capacity,
        velocityActual: rs.sprint.velocityActual,
        startDate: rs.sprint.startDate.toISOString(),
        endDate: rs.sprint.endDate.toISOString(),
        progressPct: cap > 0 ? Math.round((velocity / cap) * 100) : 0,
      }
    }),
  }))
}

export type SerializedRelease = Awaited<ReturnType<typeof listReleasesForProject>>[number]
