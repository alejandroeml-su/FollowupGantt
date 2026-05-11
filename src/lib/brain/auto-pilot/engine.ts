/**
 * Wave P20-C · Brain Auto-Pilot — Engine puro (4 detectores).
 *
 * Cada detector recibe el `AutoPilotDetectorInput` ya cargado por las server
 * actions y produce una lista de `AutoPilotProposal`. Los detectores NO
 * tocan Prisma — eso permite que tests unitarios usen fixtures inline
 * deterministas (sin mocks pesados de Prisma).
 *
 * Heurísticas:
 *   - detectSprintRebalance:  sprint sobre-cargado (sum SP > capacity * 1.1)
 *                             con sprint hermano (mismo proyecto, mismo
 *                             closing future) con holgura ≥ 20%. Propone
 *                             mover la tarea más pequeña que cierre el gap.
 *   - detectAssigneeRebalance: desbalance ≥ 40% entre miembros con skill
 *                              compartido (intersección de skillIds). Propone
 *                              reasignar la tarea menor del más cargado.
 *   - detectSprintExtensionNeeded: scope > velocityP50 del proyecto. Propone
 *                                  +N días (round 3-day increments) hasta cubrir
 *                                  con velocity histórica.
 *   - detectLessonPromotion: lecciones con misma categoría + recommendation
 *                            repetidas en ≥ 2 proyectos del workspace. Propone
 *                            crear `GlobalTemplate` ONBOARDING_KIT con todas.
 *
 * Ids deterministas: `${kind}:${primaryEntityId}[:secondary]`. Permite que
 * el caller deduplique proposals entre ejecuciones consecutivas (la UI
 * puede usar el id como react key estable).
 */

import {
  randomUUID as nodeRandomUUID,
  createHash,
} from 'node:crypto'
import type {
  AutoPilotDetectorInput,
  AutoPilotProposal,
  AutoPilotSprintInput,
  AutoPilotTaskInput,
  AutoPilotLessonInput,
} from './types'

// ─── Helpers ─────────────────────────────────────────────────────────

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

function sumSp(tasks: AutoPilotTaskInput[]): number {
  return tasks.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0)
}

function nonClosedTasks(tasks: AutoPilotTaskInput[]): AutoPilotTaskInput[] {
  return tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED')
}

// Deterministic uuid v5-like from string seed (sha1 → uuid pattern). Evita
// requerir uuid v5 (paquete no disponible) y mantiene ids estables para
// react keys + tests.
function seededId(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// ─── Detector 1: Sprint rebalance ────────────────────────────────────

/**
 * Detecta sprints sobre-cargados con sprint hermano (mismo proyecto, fecha
 * de cierre posterior) que tenga holgura. Propone mover la task con menor
 * SP que cierre el gap (o reduzca el over-capacity al menos en 50%).
 */
export function detectSprintRebalance(
  input: AutoPilotDetectorInput,
): AutoPilotProposal[] {
  const proposals: AutoPilotProposal[] = []

  const tasksBySprint = new Map<string, AutoPilotTaskInput[]>()
  for (const t of nonClosedTasks(input.tasks)) {
    if (!t.sprintId) continue
    const arr = tasksBySprint.get(t.sprintId) ?? []
    arr.push(t)
    tasksBySprint.set(t.sprintId, arr)
  }

  const sprintsByProject = new Map<string, AutoPilotSprintInput[]>()
  for (const s of input.sprints) {
    const arr = sprintsByProject.get(s.projectId) ?? []
    arr.push(s)
    sprintsByProject.set(s.projectId, arr)
  }

  for (const [, sprints] of sprintsByProject) {
    if (sprints.length < 2) continue
    sprints.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())

    for (const overload of sprints) {
      const cap = overload.capacity
      if (cap == null || cap <= 0) continue
      const load = sumSp(tasksBySprint.get(overload.id) ?? [])
      if (load <= cap * 1.1) continue

      const target = sprints.find(
        (s) =>
          s.id !== overload.id &&
          s.capacity != null &&
          s.capacity > 0 &&
          new Date(s.endDate).getTime() > new Date(overload.endDate).getTime() &&
          sumSp(tasksBySprint.get(s.id) ?? []) <= s.capacity * 0.8,
      )
      if (!target) continue

      const candidates = (tasksBySprint.get(overload.id) ?? [])
        .filter((t) => (t.storyPoints ?? 0) > 0)
        .sort((a, b) => (a.storyPoints ?? 0) - (b.storyPoints ?? 0))
      if (candidates.length === 0) continue

      const overage = load - cap
      const moveTask =
        candidates.find((t) => (t.storyPoints ?? 0) >= overage * 0.5) ??
        candidates[0]

      const ratio = overage / cap
      const severity = ratio >= 0.4 ? 'HIGH' : ratio >= 0.2 ? 'MEDIUM' : 'LOW'
      const confidence = Math.min(1, 0.6 + ratio)

      proposals.push({
        id: seededId(
          `SPRINT_REBALANCE:${overload.id}:${target.id}:${moveTask.id}`,
        ),
        kind: 'SPRINT_REBALANCE',
        severity,
        summary: `Mover "${moveTask.title}" de "${overload.name}" → "${target.name}"`,
        rationale: `"${overload.name}" tiene ${load} SP de carga vs ${cap} de capacidad (sobrecarga ${Math.round(ratio * 100)}%). "${target.name}" tiene holgura suficiente.`,
        preview: {
          before: {
            sprint: overload.name,
            sprintLoad: load,
            sprintCapacity: cap,
            targetLoad: sumSp(tasksBySprint.get(target.id) ?? []),
            targetCapacity: target.capacity,
          },
          after: {
            sprint: target.name,
            sprintLoad: load - (moveTask.storyPoints ?? 0),
            sprintCapacity: cap,
            targetLoad:
              sumSp(tasksBySprint.get(target.id) ?? []) +
              (moveTask.storyPoints ?? 0),
            targetCapacity: target.capacity,
          },
        },
        applyOps: [
          {
            type: 'task.update',
            targetId: moveTask.id,
            patch: { sprintId: target.id },
          },
        ],
        confidence,
      })
    }
  }

  return proposals
}

// ─── Detector 2: Assignee rebalance ──────────────────────────────────

/**
 * Detecta desbalance ≥ 40% entre dos usuarios que comparten al menos una
 * skill (matching para que la reasignación sea viable). Propone reasignar
 * la tarea menor del usuario más cargado al de menor carga.
 */
export function detectAssigneeRebalance(
  input: AutoPilotDetectorInput,
): AutoPilotProposal[] {
  const proposals: AutoPilotProposal[] = []

  if (input.users.length < 2) return proposals

  const users = [...input.users].sort((a, b) => b.currentLoad - a.currentLoad)

  for (let i = 0; i < users.length; i++) {
    const heavy = users[i]
    if (heavy.currentLoad <= 0) continue
    for (let j = users.length - 1; j > i; j--) {
      const light = users[j]
      if (light.userId === heavy.userId) continue
      const heavySkills = new Set(heavy.skillIds)
      const shared = light.skillIds.filter((s) => heavySkills.has(s))
      if (shared.length === 0) continue

      const delta = heavy.currentLoad - light.currentLoad
      if (delta <= 0) continue
      const ratio = delta / Math.max(1, heavy.currentLoad)
      if (ratio < 0.4) continue

      const candidates = input.tasks
        .filter(
          (t) =>
            t.assigneeId === heavy.userId &&
            t.status !== 'DONE' &&
            t.status !== 'CANCELLED' &&
            (t.storyPoints ?? 0) > 0,
        )
        .sort((a, b) => (a.storyPoints ?? 0) - (b.storyPoints ?? 0))
      if (candidates.length === 0) continue

      const move = candidates[0]
      const severity = ratio >= 0.7 ? 'HIGH' : ratio >= 0.5 ? 'MEDIUM' : 'LOW'
      const confidence = Math.min(1, 0.55 + ratio * 0.6)

      proposals.push({
        id: seededId(
          `ASSIGNEE_REBALANCE:${heavy.userId}:${light.userId}:${move.id}`,
        ),
        kind: 'ASSIGNEE_REBALANCE',
        severity,
        summary: `Reasignar "${move.title}" de ${heavy.userName} → ${light.userName}`,
        rationale: `${heavy.userName} acumula ${heavy.currentLoad} SP vs ${light.userName} con ${light.currentLoad} SP (gap ${Math.round(ratio * 100)}%). Ambos comparten ${shared.length} skill(s).`,
        preview: {
          before: {
            assignee: heavy.userName,
            heavyLoad: heavy.currentLoad,
            lightLoad: light.currentLoad,
          },
          after: {
            assignee: light.userName,
            heavyLoad: heavy.currentLoad - (move.storyPoints ?? 0),
            lightLoad: light.currentLoad + (move.storyPoints ?? 0),
          },
        },
        applyOps: [
          {
            type: 'task.update',
            targetId: move.id,
            patch: { assigneeId: light.userId },
          },
        ],
        confidence,
      })
      break
    }
  }

  return proposals
}

// ─── Detector 3: Sprint extension needed ─────────────────────────────

/**
 * Sprint con scope abierto > velocity histórica P50 del proyecto. Propone
 * extender la fecha de cierre en bloques de 3 días hasta que el scope
 * proyectado cabe dentro de la velocity.
 */
export function detectSprintExtensionNeeded(
  input: AutoPilotDetectorInput,
): AutoPilotProposal[] {
  const proposals: AutoPilotProposal[] = []

  const tasksBySprint = new Map<string, AutoPilotTaskInput[]>()
  for (const t of nonClosedTasks(input.tasks)) {
    if (!t.sprintId) continue
    const arr = tasksBySprint.get(t.sprintId) ?? []
    arr.push(t)
    tasksBySprint.set(t.sprintId, arr)
  }

  for (const s of input.sprints) {
    if (s.velocityP50 == null || s.velocityP50 <= 0) continue
    const scope = sumSp(tasksBySprint.get(s.id) ?? [])
    if (scope <= s.velocityP50) continue

    const dailyVelocity = s.velocityP50 / 14
    const missingSp = scope - s.velocityP50
    const extraDaysRaw = missingSp / Math.max(0.5, dailyVelocity)
    const extraDays = Math.min(15, Math.max(3, Math.ceil(extraDaysRaw / 3) * 3))

    const ratio = missingSp / s.velocityP50
    const severity = ratio >= 0.4 ? 'HIGH' : ratio >= 0.2 ? 'MEDIUM' : 'LOW'
    const confidence = Math.min(0.9, 0.6 + ratio * 0.4)

    proposals.push({
      id: seededId(`SPRINT_EXTENSION:${s.id}`),
      kind: 'SPRINT_EXTENSION',
      severity,
      summary: `Extender sprint "${s.name}" en ${extraDays} días`,
      rationale: `Scope (${scope} SP) supera velocity P50 (${s.velocityP50} SP) por ${Math.round(ratio * 100)}%. Extender ${extraDays} días alinea con histórico.`,
      preview: {
        before: {
          sprint: s.name,
          endDate: s.endDate.slice(0, 10),
          scope,
          velocityP50: s.velocityP50,
        },
        after: {
          sprint: s.name,
          endDate: addDays(s.endDate, extraDays).slice(0, 10),
          scope,
          velocityP50: s.velocityP50,
        },
      },
      applyOps: [
        {
          type: 'sprint.update',
          targetId: s.id,
          patch: { endDate: addDays(s.endDate, extraDays) },
        },
      ],
      confidence,
    })
  }

  return proposals
}

// ─── Detector 4: Lesson promotion ────────────────────────────────────

/**
 * Detecta lecciones con la misma categoría + recommendation repetidas en
 * 2+ proyectos del workspace. Propone clonarlas como `GlobalTemplate` con
 * kind=ONBOARDING_KIT — patrón documentado en Wave P16-B.
 */
export function detectLessonPromotion(
  input: AutoPilotDetectorInput,
): AutoPilotProposal[] {
  const proposals: AutoPilotProposal[] = []
  if (input.lessons.length < 2) return proposals

  // Agrupa por (workspace, category, recommendation-normalizada).
  const groups = new Map<string, AutoPilotLessonInput[]>()
  for (const l of input.lessons) {
    const key = `${l.workspaceId}|${l.category}|${l.recommendation.trim().toLowerCase()}`
    const arr = groups.get(key) ?? []
    arr.push(l)
    groups.set(key, arr)
  }

  for (const [, lessons] of groups) {
    const distinctProjects = new Set(lessons.map((l) => l.projectId))
    if (distinctProjects.size < 2) continue

    const sample = lessons[0]
    const severity = distinctProjects.size >= 3 ? 'HIGH' : 'MEDIUM'
    const confidence = Math.min(0.95, 0.65 + distinctProjects.size * 0.07)
    const targetTemplateId = seededId(
      `LESSON_PROMOTION:${sample.workspaceId}:${sample.category}:${sample.recommendation.trim().toLowerCase()}`,
    )

    proposals.push({
      id: targetTemplateId,
      kind: 'LESSON_PROMOTION',
      severity,
      summary: `Promover lección "${sample.title}" al catálogo global (${distinctProjects.size} proyectos)`,
      rationale: `La recomendación "${sample.recommendation.slice(0, 100)}" aparece en ${distinctProjects.size} proyectos. Promoverla al catálogo del workspace evita re-aprenderla.`,
      preview: {
        before: {
          projectsAfectados: distinctProjects.size,
          enKit: 'no',
        },
        after: {
          projectsAfectados: distinctProjects.size,
          enKit: 'sí',
        },
      },
      applyOps: [
        {
          type: 'workspace.upsert_global_template',
          targetId: targetTemplateId,
          workspaceId: sample.workspaceId,
          payload: {
            name: `Lección reutilizable: ${sample.title}`,
            kind: 'DOR_DOD',
            body: {
              source: 'AUTO_PILOT_LESSON_PROMOTION',
              category: sample.category,
              recommendation: sample.recommendation,
              lessonIds: lessons.map((l) => l.id),
              sourceProjects: Array.from(distinctProjects),
            },
          },
        },
      ],
      confidence,
    })
  }

  return proposals
}

// ─── Entry point: run all detectors ──────────────────────────────────

/**
 * Corre los 4 detectores y devuelve la unión, ordenada por severity DESC
 * y confidence DESC. NO filtra por threshold — eso lo hace la UI.
 */
export function runDetectors(
  input: AutoPilotDetectorInput,
): AutoPilotProposal[] {
  const all = [
    ...detectSprintRebalance(input),
    ...detectAssigneeRebalance(input),
    ...detectSprintExtensionNeeded(input),
    ...detectLessonPromotion(input),
  ]
  const sevWeight: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }
  return all.sort((a, b) => {
    const ds = sevWeight[b.severity] - sevWeight[a.severity]
    if (ds !== 0) return ds
    return b.confidence - a.confidence
  })
}

/// Re-export para consumidores que solo quieren randomUUID estable
/// sin depender de node:crypto directamente.
export const randomUUID = nodeRandomUUID
