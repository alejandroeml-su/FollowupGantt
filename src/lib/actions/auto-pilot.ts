'use server'

/**
 * Wave P20-C · Brain Auto-Pilot — Server actions.
 *
 * Wrapper de las primitivas puras (`engine.ts` + `adapter.ts`) con:
 *   - auth gate `requireUser` + role check ADMIN/GERENCIA_GENERAL/SUPER_ADMIN
 *   - audit log fire-and-forget (`auto_pilot.proposal_applied/rolled_back`)
 *   - revalidatePath para `/brain/auto-pilot` post-mutación
 *
 * Cuatro acciones:
 *   - listProposals(): corre detectores sobre el workspace efectivo
 *   - applyProposalById(): aplica y persiste AutoPilotRun
 *   - rollbackRun(): ejecuta ops inversas y marca rolledBackAt
 *   - listAutoPilotHistory(): últimas 20 runs del workspace
 *
 * Convención: errores tipados `[CODE] detalle`. La UI mapea a toasts.
 */

import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { getDefaultWorkspaceForUser } from '@/lib/auth/check-workspace-access'
import { ROLE_NAMES } from '@/lib/auth/permissions'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  runDetectors,
} from '@/lib/brain/auto-pilot/engine'
import { applyProposal, rollbackProposal } from '@/lib/brain/auto-pilot/adapter'
import type {
  AutoPilotDetectorInput,
  AutoPilotLessonInput,
  AutoPilotOp,
  AutoPilotProposal,
  AutoPilotRunRow,
  AutoPilotSprintInput,
  AutoPilotTaskInput,
  AutoPilotUserSkillInput,
} from '@/lib/brain/auto-pilot/types'

// ─── Errores tipados ────────────────────────────────────────────────

type AutoPilotErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PROPOSAL_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'ALREADY_ROLLED_BACK'
  | 'ROLLBACK_WINDOW_EXPIRED'
  | 'CONFIDENCE_TOO_LOW'

function actionError(code: AutoPilotErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const ALLOWED_ROLES = new Set<string>([
  ROLE_NAMES.ADMIN,
  ROLE_NAMES.GERENCIA_GENERAL,
  ROLE_NAMES.SUPER_ADMIN,
])

function ensureRole(roles: readonly string[]): void {
  for (const r of roles) {
    if (ALLOWED_ROLES.has(r)) return
  }
  actionError(
    'FORBIDDEN',
    'Solo ADMIN/GERENCIA_GENERAL/SUPER_ADMIN pueden ejecutar Auto-Pilot',
  )
}

const MIN_CONFIDENCE = 0.6
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000

// ─── Load workspace context ─────────────────────────────────────────

async function resolveActiveWorkspaceId(userId: string): Promise<string> {
  const ws = await getDefaultWorkspaceForUser(userId)
  return ws.id
}

// ─── listProposals ──────────────────────────────────────────────────

export interface ListProposalsResult {
  workspaceId: string
  proposals: AutoPilotProposal[]
  generatedAt: string
}

/**
 * Carga datos del workspace activo, corre los 4 detectores y devuelve
 * proposals filtradas por `confidence >= 0.6`.
 */
export async function listProposals(): Promise<ListProposalsResult> {
  const user = await requireUser()
  ensureRole(user.roles)

  const workspaceId = await resolveActiveWorkspaceId(user.id)

  // Proyectos del workspace (activos o planning).
  const projects = await prisma.project.findMany({
    where: {
      workspaceId,
      status: { in: ['ACTIVE', 'PLANNING'] },
    },
    select: { id: true, name: true },
  })
  const projectIds = projects.map((p) => p.id)
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))

  // Sprints abiertos / planeados.
  const sprintRows = await prisma.sprint.findMany({
    where: {
      projectId: { in: projectIds },
      status: { in: ['ACTIVE', 'PLANNING'] },
    },
    select: {
      id: true,
      name: true,
      projectId: true,
      endDate: true,
      capacity: true,
      velocityActual: true,
    },
  })

  // Velocity P50 por proyecto (mediana de velocityActual de sprints
  // cerrados con velocity registrada).
  const closedSprints = await prisma.sprint.findMany({
    where: {
      projectId: { in: projectIds },
      status: 'COMPLETED',
      velocityActual: { not: null },
    },
    select: { projectId: true, velocityActual: true },
  })
  const velocityP50ByProject = computeP50ByProject(closedSprints)

  const sprints: AutoPilotSprintInput[] = sprintRows.map((s) => ({
    id: s.id,
    name: s.name,
    projectId: s.projectId,
    projectName: projectNameById.get(s.projectId) ?? '—',
    endDate: s.endDate.toISOString(),
    capacity: s.capacity,
    velocityP50: velocityP50ByProject.get(s.projectId) ?? null,
  }))

  // Tasks abiertas en esos proyectos.
  const taskRows = await prisma.task.findMany({
    where: {
      projectId: { in: projectIds },
      archivedAt: null,
    },
    select: {
      id: true,
      title: true,
      projectId: true,
      sprintId: true,
      assigneeId: true,
      storyPoints: true,
      status: true,
    },
  })

  const tasks: AutoPilotTaskInput[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    sprintId: t.sprintId,
    assigneeId: t.assigneeId,
    storyPoints: t.storyPoints,
    status: t.status,
  }))

  // Usuarios del workspace + sus skills + carga (SP abiertos asignados).
  const memberRows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          userSkills: { select: { skillId: true } },
        },
      },
    },
  })

  const loadByUser = new Map<string, number>()
  for (const t of tasks) {
    if (!t.assigneeId) continue
    if (t.status === 'DONE' || t.status === 'CANCELLED') continue
    const sp = t.storyPoints ?? 0
    loadByUser.set(t.assigneeId, (loadByUser.get(t.assigneeId) ?? 0) + sp)
  }

  const users: AutoPilotUserSkillInput[] = memberRows.map((m) => ({
    userId: m.user.id,
    userName: m.user.name,
    skillIds: m.user.userSkills.map((s) => s.skillId),
    currentLoad: loadByUser.get(m.user.id) ?? 0,
  }))

  // Lessons del workspace (de los proyectos activos).
  const lessonRows = await prisma.lessonLearned.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      id: true,
      projectId: true,
      category: true,
      title: true,
      recommendation: true,
      createdAt: true,
    },
  })

  const lessons: AutoPilotLessonInput[] = lessonRows.map((l) => ({
    id: l.id,
    projectId: l.projectId,
    projectName: projectNameById.get(l.projectId) ?? '—',
    workspaceId,
    category: l.category,
    title: l.title,
    recommendation: l.recommendation,
    capturedAt: l.createdAt.toISOString(),
  }))

  const detectorInput: AutoPilotDetectorInput = {
    sprints,
    tasks,
    users,
    lessons,
    workspaceId,
  }

  const all = runDetectors(detectorInput)
  const proposals = all.filter((p) => p.confidence >= MIN_CONFIDENCE)

  return {
    workspaceId,
    proposals,
    generatedAt: new Date().toISOString(),
  }
}

function computeP50ByProject(
  rows: { projectId: string; velocityActual: number | null }[],
): Map<string, number> {
  const byProject = new Map<string, number[]>()
  for (const r of rows) {
    if (r.velocityActual == null) continue
    const arr = byProject.get(r.projectId) ?? []
    arr.push(r.velocityActual)
    byProject.set(r.projectId, arr)
  }
  const out = new Map<string, number>()
  for (const [pid, arr] of byProject) {
    arr.sort((a, b) => a - b)
    const mid = Math.floor(arr.length / 2)
    const p50 = arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid]
    out.set(pid, p50)
  }
  return out
}

// ─── applyProposalById ──────────────────────────────────────────────

export interface ApplyProposalResult {
  runId: string
  appliedAt: string
}

/**
 * Aplica un proposal por id. Re-corre detectores para localizar el proposal
 * — no aceptamos un blob arbitrario desde el cliente por seguridad.
 */
export async function applyProposalById(
  proposalId: string,
): Promise<ApplyProposalResult> {
  if (!proposalId || typeof proposalId !== 'string') {
    actionError('PROPOSAL_NOT_FOUND', 'proposalId requerido')
  }

  const user = await requireUser()
  ensureRole(user.roles)

  const { workspaceId, proposals } = await listProposals()
  const proposal = proposals.find((p) => p.id === proposalId)
  if (!proposal) {
    actionError('PROPOSAL_NOT_FOUND', `Proposal ${proposalId} ya no es vigente`)
  }
  if (proposal.confidence < MIN_CONFIDENCE) {
    actionError(
      'CONFIDENCE_TOO_LOW',
      `Confidence ${proposal.confidence.toFixed(2)} < ${MIN_CONFIDENCE}`,
    )
  }

  const { rollbackOps } = await applyProposal(proposal)

  const run = await prisma.autoPilotRun.create({
    data: {
      workspaceId,
      kind: proposal.kind,
      summary: proposal.summary,
      proposalSnapshot: proposal as unknown as Prisma.InputJsonValue,
      appliedById: user.id,
      rollbackOps: rollbackOps as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, appliedAt: true },
  })

  void recordAuditEventSafe({
    actorId: user.id,
    action: 'auto_pilot.proposal_applied',
    entityType: 'auto_pilot_run',
    entityId: run.id,
    after: {
      kind: proposal.kind,
      summary: proposal.summary,
      confidence: proposal.confidence,
      severity: proposal.severity,
    },
    metadata: { workspaceId, proposalId: proposal.id },
  })

  revalidatePath('/brain/auto-pilot')

  return {
    runId: run.id,
    appliedAt: run.appliedAt.toISOString(),
  }
}

// ─── rollbackRun ────────────────────────────────────────────────────

export async function rollbackRun(runId: string): Promise<void> {
  if (!runId || typeof runId !== 'string') {
    actionError('RUN_NOT_FOUND', 'runId requerido')
  }

  const user = await requireUser()
  ensureRole(user.roles)

  const run = await prisma.autoPilotRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      workspaceId: true,
      kind: true,
      summary: true,
      rolledBackAt: true,
      appliedAt: true,
      rollbackOps: true,
    },
  })
  if (!run) {
    actionError('RUN_NOT_FOUND', `Run ${runId} no existe`)
  }
  if (run.rolledBackAt) {
    actionError('ALREADY_ROLLED_BACK', `Run ${runId} ya fue revertido`)
  }
  if (Date.now() - run.appliedAt.getTime() > ROLLBACK_WINDOW_MS) {
    actionError(
      'ROLLBACK_WINDOW_EXPIRED',
      'Ventana de rollback (24h) expirada',
    )
  }

  const ops = (run.rollbackOps ?? []) as unknown as AutoPilotOp[]
  if (!Array.isArray(ops) || ops.length === 0) {
    actionError('RUN_NOT_FOUND', `Run ${runId} no tiene rollback ops válidas`)
  }

  await rollbackProposal(ops)

  await prisma.autoPilotRun.update({
    where: { id: runId },
    data: { rolledBackAt: new Date() },
  })

  void recordAuditEventSafe({
    actorId: user.id,
    action: 'auto_pilot.proposal_rolled_back',
    entityType: 'auto_pilot_run',
    entityId: run.id,
    before: { kind: run.kind, summary: run.summary },
    metadata: { workspaceId: run.workspaceId },
  })

  revalidatePath('/brain/auto-pilot')
}

// ─── listAutoPilotHistory ──────────────────────────────────────────

export async function listAutoPilotHistory(
  workspaceId?: string,
): Promise<AutoPilotRunRow[]> {
  const user = await requireUser()
  ensureRole(user.roles)

  const wsId = workspaceId ?? (await resolveActiveWorkspaceId(user.id))

  const rows = await prisma.autoPilotRun.findMany({
    where: { workspaceId: wsId },
    orderBy: { appliedAt: 'desc' },
    take: 20,
    include: { appliedBy: { select: { name: true } } },
  })

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    kind: r.kind as AutoPilotRunRow['kind'],
    summary: r.summary,
    proposalSnapshot: r.proposalSnapshot as unknown as AutoPilotProposal,
    appliedById: r.appliedById,
    appliedByName: r.appliedBy?.name ?? null,
    appliedAt: r.appliedAt.toISOString(),
    rolledBackAt: r.rolledBackAt ? r.rolledBackAt.toISOString() : null,
    rollbackOps: (r.rollbackOps as unknown as AutoPilotOp[]) ?? null,
  }))
}
