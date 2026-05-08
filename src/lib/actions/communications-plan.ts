'use server'

/**
 * Wave P12 (PMI 100%) — Communications Plan formal.
 */

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  normalizeCommPlan,
  type CommunicationItem,
  type CommunicationsPlan,
} from '@/lib/communications/types'

function revalidateScopes(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/communications`)
}

export async function getCommunicationsPlan(input: {
  projectId: string
}): Promise<CommunicationsPlan> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { communicationsPlan: true },
  })
  if (!project) throw new Error('[NOT_FOUND] proyecto no existe')
  return normalizeCommPlan(project.communicationsPlan)
}

export async function setCommunicationsPlan(input: {
  projectId: string
  items: CommunicationItem[]
  actorId?: string
}) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { communicationsPlan: true },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')

  const cleanItems: CommunicationItem[] = (input.items || [])
    .map((i) => ({
      id: i.id || `c-${Math.random().toString(36).slice(2, 10)}`,
      audience: i.audience.trim(),
      frequency: i.frequency,
      channel: i.channel,
      owner: i.owner.trim(),
      nextDelivery: i.nextDelivery,
      notes: (i.notes || '').trim(),
    }))
    .filter((i) => i.audience.length > 0 && i.owner.length > 0)

  const next: CommunicationsPlan = {
    items: cleanItems,
    updatedAt: new Date().toISOString(),
  }

  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      communicationsPlan: next as unknown as Prisma.InputJsonValue,
    },
  })

  await recordAuditEventSafe({
    action: 'project.comms_plan_updated',
    entityType: 'project',
    entityId: input.projectId,
    actorId: input.actorId,
    after: { itemCount: cleanItems.length },
  })

  revalidateScopes(input.projectId)
  return next
}
