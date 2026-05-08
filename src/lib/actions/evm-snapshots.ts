'use server'

/**
 * Wave P12 (PMI 100%) — EVM Snapshots para S-curve dashboard.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { computeEVMForProject } from '@/lib/evm/snapshot'

function revalidateScopes(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/evm`)
  revalidatePath('/portfolio/evm')
}

export interface SerializedEVMSnapshot {
  id: string
  projectId: string
  snapshotDate: string
  plannedValue: number
  earnedValue: number
  actualCost: number
  budgetAtCompletion: number | null
  cpi: number | null
  spi: number | null
  estimateAtCompletion: number | null
  varianceAtCompletion: number | null
  notes: string | null
}

export async function listEVMSnapshots(input: {
  projectId: string
}): Promise<SerializedEVMSnapshot[]> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  const rows = await prisma.eVMSnapshot.findMany({
    where: { projectId: input.projectId },
    orderBy: { snapshotDate: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    snapshotDate: r.snapshotDate.toISOString(),
    plannedValue: Number(r.plannedValue),
    earnedValue: Number(r.earnedValue),
    actualCost: Number(r.actualCost),
    budgetAtCompletion: r.budgetAtCompletion ? Number(r.budgetAtCompletion) : null,
    cpi: r.cpi ?? null,
    spi: r.spi ?? null,
    estimateAtCompletion: r.estimateAtCompletion
      ? Number(r.estimateAtCompletion)
      : null,
    varianceAtCompletion: r.varianceAtCompletion
      ? Number(r.varianceAtCompletion)
      : null,
    notes: r.notes,
  }))
}

export async function captureEVMSnapshot(input: {
  projectId: string
  notes?: string
  actorId?: string
}) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  })
  if (!project) throw new Error('[NOT_FOUND] proyecto no existe')

  const computed = await computeEVMForProject(input.projectId)

  const created = await prisma.eVMSnapshot.create({
    data: {
      projectId: input.projectId,
      plannedValue: computed.plannedValue,
      earnedValue: computed.earnedValue,
      actualCost: computed.actualCost,
      budgetAtCompletion: computed.budgetAtCompletion,
      cpi: computed.cpi,
      spi: computed.spi,
      estimateAtCompletion: computed.estimateAtCompletion,
      varianceAtCompletion: computed.varianceAtCompletion,
      notes: input.notes?.trim() || null,
    },
  })

  await recordAuditEventSafe({
    action: 'evm.snapshot_captured',
    entityType: 'project',
    entityId: input.projectId,
    actorId: input.actorId,
    after: {
      cpi: computed.cpi,
      spi: computed.spi,
      ev: computed.earnedValue,
    },
  })

  revalidateScopes(input.projectId)
  return created
}

export async function deleteEVMSnapshot(input: { id: string }) {
  const before = await prisma.eVMSnapshot.findUnique({ where: { id: input.id } })
  if (!before) return { ok: true }
  await prisma.eVMSnapshot.delete({ where: { id: input.id } })
  revalidateScopes(before.projectId)
  return { ok: true }
}
