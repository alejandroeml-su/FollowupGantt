'use server'

/**
 * Wave P11-PMI (HU-12.3) — Server actions Change Control Board (CCB).
 *
 * Wave P18 hardening — TODAS las queries pasan por
 * `withRlsContextFromSession()` para activar la RLS restrictiva
 * `ChangeRequest_member_only` (solo miembros del proyecto pueden
 * leer/escribir filas).
 */

import { revalidatePath } from 'next/cache'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { withRlsContextFromSession } from '@/lib/db/with-rls-context'

type ChangeImpactLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'
type ChangeRequestStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'IMPLEMENTED'

function revalidateCRs(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/change-requests`)
}

export async function listChangeRequests(projectId: string) {
  if (!projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  return withRlsContextFromSession((tx) =>
    tx.changeRequest.findMany({
      where: { projectId },
      include: {
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
  )
}

export interface CreateChangeRequestInput {
  projectId: string
  title: string
  description: string
  rationale?: string | null
  requestedById: string
  impactScope?: ChangeImpactLevel
  impactSchedule?: ChangeImpactLevel
  impactCost?: ChangeImpactLevel
  impactQuality?: ChangeImpactLevel
  estimatedCostDelta?: number | null
  estimatedScheduleDeltaDays?: number | null
}

export async function createChangeRequest(input: CreateChangeRequestInput) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.title?.trim()) throw new Error('[INVALID_INPUT] title requerido')
  if (!input.description?.trim()) {
    throw new Error('[INVALID_INPUT] description requerido')
  }
  if (!input.requestedById) {
    throw new Error('[INVALID_INPUT] requestedById requerido')
  }

  const created = await withRlsContextFromSession((tx) =>
    tx.changeRequest.create({
      data: {
        projectId: input.projectId,
        title: input.title.trim(),
        description: input.description.trim(),
        rationale: input.rationale?.trim() || null,
        requestedById: input.requestedById,
        impactScope: input.impactScope ?? 'NONE',
        impactSchedule: input.impactSchedule ?? 'NONE',
        impactCost: input.impactCost ?? 'NONE',
        impactQuality: input.impactQuality ?? 'NONE',
        estimatedCostDelta:
          input.estimatedCostDelta != null
            ? (input.estimatedCostDelta as unknown as never)
            : null,
        estimatedScheduleDeltaDays: input.estimatedScheduleDeltaDays ?? null,
        status: 'SUBMITTED',
      },
    }),
  )

  await recordAuditEventSafe({
    action: 'change_request.submitted',
    entityType: 'change_request',
    entityId: created.id,
    after: { title: created.title, projectId: input.projectId },
  })

  revalidateCRs(input.projectId)
  return created
}

export async function decideChangeRequest(input: {
  id: string
  status: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'IMPLEMENTED' | 'UNDER_REVIEW'
  decidedById: string
  decisionNotes?: string | null
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const result = await withRlsContextFromSession(async (tx) => {
    const before = await tx.changeRequest.findUnique({
      where: { id: input.id },
      select: { id: true, status: true, projectId: true },
    })
    if (!before) throw new Error('[NOT_FOUND] change request no existe')

    const updated = await tx.changeRequest.update({
      where: { id: input.id },
      data: {
        status: input.status as ChangeRequestStatus,
        decidedAt: new Date(),
        decidedById: input.decidedById,
        decisionNotes: input.decisionNotes?.trim() || null,
      },
    })
    return { before, updated }
  })

  await recordAuditEventSafe({
    action: `change_request.${input.status.toLowerCase()}` as
      | 'change_request.approved'
      | 'change_request.rejected'
      | 'change_request.deferred'
      | 'change_request.implemented'
      | 'change_request.under_review',
    entityType: 'change_request',
    entityId: input.id,
    actorId: input.decidedById,
    before: { status: result.before.status },
    after: { status: result.updated.status },
  })

  revalidateCRs(result.before.projectId)
  return result.updated
}
