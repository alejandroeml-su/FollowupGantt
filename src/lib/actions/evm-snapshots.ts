'use server'

/**
 * Wave P12 (PMI 100%) — EVM Snapshots para S-curve dashboard.
 *
 * Wave P18 hardening — TODAS las queries pasan por
 * `withRlsContextFromSession()` para activar la RLS restrictiva
 * `EVMSnapshot_member_only` (solo miembros del proyecto pueden
 * leer/escribir filas).
 */

import { revalidatePath } from 'next/cache'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { computeEVMForProject } from '@/lib/evm/snapshot'
import { withRlsContextFromSession } from '@/lib/db/with-rls-context'

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
  const rows = await withRlsContextFromSession((tx) =>
    tx.eVMSnapshot.findMany({
      where: { projectId: input.projectId },
      orderBy: { snapshotDate: 'asc' },
    }),
  )
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
  const project = await withRlsContextFromSession((tx) =>
    tx.project.findUnique({
      where: { id: input.projectId },
      select: { id: true },
    }),
  )
  if (!project) throw new Error('[NOT_FOUND] proyecto no existe')

  // `computeEVMForProject` ejecuta queries fuera del wrapper RLS:
  // depende de Project/Task/CostEntry/Budget, que actualmente NO
  // tienen policy restrictiva activa (siguen permissive). Si más
  // adelante se restringen, habrá que portarlo también al wrapper.
  const computed = await computeEVMForProject(input.projectId)

  const created = await withRlsContextFromSession((tx) =>
    tx.eVMSnapshot.create({
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
    }),
  )

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
  const before = await withRlsContextFromSession(async (tx) => {
    const row = await tx.eVMSnapshot.findUnique({
      where: { id: input.id },
      select: { projectId: true },
    })
    if (!row) return null
    await tx.eVMSnapshot.delete({ where: { id: input.id } })
    return row
  })
  if (!before) return { ok: true }
  revalidateScopes(before.projectId)
  return { ok: true }
}
