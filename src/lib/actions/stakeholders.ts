'use server'

/**
 * Wave P11-PMI (HU-12.2) — Server actions Stakeholder Register.
 *
 * Nota: el helper síncrono `suggestEngagementStrategy` vive en
 * `lib/stakeholders/engagement.ts` para cumplir la regla "files con
 * 'use server' solo exportan funciones async". Importar desde ahí.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  suggestEngagementStrategy,
  type StakeholderInfluence,
  type StakeholderLevel,
} from '@/lib/stakeholders/engagement'

function revalidateStakeholders(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/stakeholders`)
}

export async function listStakeholders(projectId: string) {
  if (!projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  return prisma.stakeholder.findMany({
    where: { projectId },
    orderBy: [{ power: 'desc' }, { interest: 'desc' }, { name: 'asc' }],
  })
}

export interface CreateStakeholderInput {
  projectId: string
  name: string
  organization?: string | null
  email?: string | null
  role: string
  power?: StakeholderLevel
  interest?: StakeholderLevel
  influence?: StakeholderInfluence
  expectations?: string | null
  engagementStrategy?: string | null
  notes?: string | null
}

export async function createStakeholder(input: CreateStakeholderInput) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.name?.trim()) throw new Error('[INVALID_INPUT] name requerido')
  if (!input.role?.trim()) throw new Error('[INVALID_INPUT] role requerido')

  const power = input.power ?? 'MEDIUM'
  const interest = input.interest ?? 'MEDIUM'
  const engagementStrategy =
    input.engagementStrategy ?? suggestEngagementStrategy(power, interest)

  const created = await prisma.stakeholder.create({
    data: {
      projectId: input.projectId,
      name: input.name.trim(),
      organization: input.organization?.trim() || null,
      email: input.email?.trim() || null,
      role: input.role.trim(),
      power,
      interest,
      influence: input.influence ?? 'NEUTRAL',
      expectations: input.expectations?.trim() || null,
      engagementStrategy,
      notes: input.notes?.trim() || null,
    },
  })

  await recordAuditEventSafe({
    action: 'stakeholder.created',
    entityType: 'stakeholder',
    entityId: created.id,
    after: { name: created.name, role: created.role, projectId: input.projectId },
  })

  revalidateStakeholders(input.projectId)
  return created
}

export async function updateStakeholder(input: {
  id: string
  name?: string
  organization?: string | null
  email?: string | null
  role?: string
  power?: StakeholderLevel
  interest?: StakeholderLevel
  influence?: StakeholderInfluence
  expectations?: string | null
  engagementStrategy?: string | null
  notes?: string | null
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')
  const before = await prisma.stakeholder.findUnique({ where: { id: input.id } })
  if (!before) throw new Error('[NOT_FOUND] stakeholder no existe')

  const updated = await prisma.stakeholder.update({
    where: { id: input.id },
    data: {
      name: input.name?.trim() ?? before.name,
      organization:
        input.organization === undefined ? before.organization : input.organization,
      email: input.email === undefined ? before.email : input.email,
      role: input.role?.trim() ?? before.role,
      power: input.power ?? before.power,
      interest: input.interest ?? before.interest,
      influence: input.influence ?? before.influence,
      expectations:
        input.expectations === undefined ? before.expectations : input.expectations,
      engagementStrategy:
        input.engagementStrategy === undefined
          ? before.engagementStrategy
          : input.engagementStrategy,
      notes: input.notes === undefined ? before.notes : input.notes,
    },
  })

  await recordAuditEventSafe({
    action: 'stakeholder.updated',
    entityType: 'stakeholder',
    entityId: input.id,
    before: { power: before.power, interest: before.interest },
    after: { power: updated.power, interest: updated.interest },
  })

  revalidateStakeholders(before.projectId)
  return updated
}

export async function deleteStakeholder(id: string) {
  if (!id) throw new Error('[INVALID_INPUT] id requerido')
  const before = await prisma.stakeholder.findUnique({ where: { id } })
  if (!before) throw new Error('[NOT_FOUND] stakeholder no existe')

  await prisma.stakeholder.delete({ where: { id } })

  await recordAuditEventSafe({
    action: 'stakeholder.deleted',
    entityType: 'stakeholder',
    entityId: id,
    before: { name: before.name, role: before.role },
  })

  revalidateStakeholders(before.projectId)
  return { ok: true as const }
}
