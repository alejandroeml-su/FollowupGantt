'use server'

/**
 * Wave P11-PMI (HU-12.1) — Server actions Project Charter.
 */

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  normalizeCharter,
  type ProjectCharter,
} from '@/lib/charter/types'

function revalidateCharter(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/charter`)
}

export async function getCharter(projectId: string): Promise<ProjectCharter> {
  if (!projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { charter: true },
  })
  if (!project) throw new Error('[NOT_FOUND] proyecto no existe')
  return normalizeCharter(project.charter)
}

export async function setCharter(input: {
  projectId: string
  vision: string
  businessJustification: string
  successCriteria: string[]
  milestones: { name: string; targetDate: string | null }[]
}): Promise<ProjectCharter> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.vision?.trim()) throw new Error('[INVALID_INPUT] vision requerido')
  if (!input.businessJustification?.trim()) {
    throw new Error('[INVALID_INPUT] businessJustification requerido')
  }

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { charter: true },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')
  const prev = normalizeCharter(before.charter)

  const next: ProjectCharter = {
    vision: input.vision.trim(),
    businessJustification: input.businessJustification.trim(),
    successCriteria: input.successCriteria
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 15),
    milestones: input.milestones
      .map((m) => ({ name: m.name.trim(), targetDate: m.targetDate || null }))
      .filter((m) => m.name.length > 0)
      .slice(0, 20),
    approvedAt: prev.approvedAt,
    approvedBy: prev.approvedBy,
    version: prev.version + 1,
  }

  await prisma.project.update({
    where: { id: input.projectId },
    data: { charter: next as unknown as Prisma.InputJsonValue },
  })

  await recordAuditEventSafe({
    action: 'project.charter_updated',
    entityType: 'project',
    entityId: input.projectId,
    before: { version: prev.version },
    after: { version: next.version },
  })

  revalidateCharter(input.projectId)
  return next
}

export async function approveCharter(input: {
  projectId: string
  approverId: string
  approverName: string
}): Promise<ProjectCharter> {
  const current = await getCharter(input.projectId)
  if (!current.vision || !current.businessJustification) {
    throw new Error('[INVALID_INPUT] Charter incompleto · define vision y justificación primero')
  }

  const next: ProjectCharter = {
    ...current,
    approvedAt: new Date().toISOString(),
    approvedBy: input.approverName,
  }

  await prisma.project.update({
    where: { id: input.projectId },
    data: { charter: next as unknown as Prisma.InputJsonValue },
  })

  await recordAuditEventSafe({
    action: 'project.charter_approved',
    entityType: 'project',
    entityId: input.projectId,
    actorId: input.approverId,
    after: { approvedAt: next.approvedAt, approvedBy: next.approvedBy },
  })

  revalidateCharter(input.projectId)
  return next
}
