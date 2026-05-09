'use server'

/**
 * Wave P14 (Project Definition · Mantenimiento) — Server actions para
 * editar la definición de un proyecto existente y gestionar sus miembros
 * (usuarios + equipos).
 *
 * Reusa `requireProjectAccess` (Wave P13) para enforcement de visibilidad.
 */

import { revalidatePath } from 'next/cache'
import type { ProjectMethodology, ProjectStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { recordAuditEventSafe } from '@/lib/audit/events'

function revalidateScopes(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/settings`)
  revalidatePath('/projects')
}

export interface UpdateProjectDefinitionInput {
  projectId: string
  name?: string
  description?: string | null
  status?: ProjectStatus
  methodology?: ProjectMethodology
  areaId?: string | null
  managerId?: string | null
  budget?: number | null
  budgetCurrency?: string | null
  startDate?: string | null
  endDate?: string | null
}

/**
 * Actualiza la definición de un proyecto existente. Solo campos
 * explícitamente pasados se modifican (undefined = no tocar).
 */
export async function updateProjectDefinition(
  input: UpdateProjectDefinitionInput,
) {
  if (!input.projectId)
    throw new Error('[INVALID_INPUT] projectId requerido')

  const user = await requireProjectAccess(input.projectId)

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      name: true,
      description: true,
      status: true,
      methodology: true,
      areaId: true,
      managerId: true,
      budget: true,
      budgetCurrency: true,
    },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name.trim()
  if (input.description !== undefined)
    data.description = input.description?.trim() || null
  if (input.status !== undefined) data.status = input.status
  if (input.methodology !== undefined) data.methodology = input.methodology
  if (input.areaId !== undefined) data.areaId = input.areaId
  if (input.managerId !== undefined) data.managerId = input.managerId
  if (input.budget !== undefined) {
    data.budget = input.budget
    data.budgetCurrency = input.budgetCurrency ?? 'USD'
  }

  const updated = await prisma.project.update({
    where: { id: input.projectId },
    data,
    select: {
      id: true,
      name: true,
      methodology: true,
      areaId: true,
      managerId: true,
    },
  })

  await recordAuditEventSafe({
    action: 'project.created',
    entityType: 'project',
    entityId: input.projectId,
    actorId: user.id,
    metadata: { op: 'definition_updated', changedKeys: Object.keys(data) },
  })

  revalidateScopes(input.projectId)
  return updated
}

// ─────────────── Miembros (usuarios) ───────────────

export async function addProjectMember(input: {
  projectId: string
  userId: string
}) {
  if (!input.projectId || !input.userId)
    throw new Error('[INVALID_INPUT] projectId y userId requeridos')
  const actor = await requireProjectAccess(input.projectId)

  await prisma.projectAssignment.upsert({
    where: {
      projectId_userId: {
        projectId: input.projectId,
        userId: input.userId,
      },
    },
    update: {},
    create: { projectId: input.projectId, userId: input.userId },
  })

  await recordAuditEventSafe({
    action: 'permission.granted',
    entityType: 'project',
    entityId: input.projectId,
    actorId: actor.id,
    metadata: { userId: input.userId, scope: 'member' },
  })

  revalidateScopes(input.projectId)
  return { ok: true }
}

export async function removeProjectMember(input: {
  projectId: string
  userId: string
}) {
  const actor = await requireProjectAccess(input.projectId)
  await prisma.projectAssignment.deleteMany({
    where: { projectId: input.projectId, userId: input.userId },
  })
  await recordAuditEventSafe({
    action: 'permission.revoked',
    entityType: 'project',
    entityId: input.projectId,
    actorId: actor.id,
    metadata: { userId: input.userId, scope: 'member' },
  })
  revalidateScopes(input.projectId)
  return { ok: true }
}

// ─────────────── Equipos ───────────────

export async function addProjectTeam(input: {
  projectId: string
  teamId: string
}) {
  if (!input.projectId || !input.teamId)
    throw new Error('[INVALID_INPUT] projectId y teamId requeridos')
  const actor = await requireProjectAccess(input.projectId)

  await prisma.teamProject.upsert({
    where: {
      teamId_projectId: { teamId: input.teamId, projectId: input.projectId },
    },
    update: {},
    create: { teamId: input.teamId, projectId: input.projectId },
  })

  await recordAuditEventSafe({
    action: 'permission.granted',
    entityType: 'project',
    entityId: input.projectId,
    actorId: actor.id,
    metadata: { teamId: input.teamId, scope: 'team' },
  })

  revalidateScopes(input.projectId)
  return { ok: true }
}

export async function removeProjectTeam(input: {
  projectId: string
  teamId: string
}) {
  const actor = await requireProjectAccess(input.projectId)
  await prisma.teamProject.deleteMany({
    where: { projectId: input.projectId, teamId: input.teamId },
  })
  await recordAuditEventSafe({
    action: 'permission.revoked',
    entityType: 'project',
    entityId: input.projectId,
    actorId: actor.id,
    metadata: { teamId: input.teamId, scope: 'team' },
  })
  revalidateScopes(input.projectId)
  return { ok: true }
}

// ─────────────── Lectura ───────────────

export async function getProjectDefinition(projectId: string) {
  if (!projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      methodology: true,
      areaId: true,
      area: {
        select: {
          id: true,
          name: true,
          gerenciaId: true,
          gerencia: { select: { id: true, name: true } },
        },
      },
      managerId: true,
      manager: { select: { id: true, name: true } },
      budget: true,
      budgetCurrency: true,
      assignments: {
        select: { user: { select: { id: true, name: true, email: true } } },
      },
      teamProjects: {
        select: {
          team: {
            select: {
              id: true,
              name: true,
              members: {
                select: { user: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  })
}
