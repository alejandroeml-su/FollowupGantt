/**
 * Sugerencias de rebalanceo de carga (Ola P8 · Equipo P8-1).
 *
 * Módulo PURO determinista. Dado el resultado de `computeWorkload` y un
 * map de capacidades, busca días con overload y propone reasignar
 * tareas no críticas a otros usuarios con la skill primaria requerida y
 * holgura en un día cercano (±5 días por defecto).
 *
 * Estrategia:
 *   - Greedy en orden de severidad: el día con mayor overload se
 *     resuelve primero.
 *   - Para cada task que aporta al día overloaded, busca candidatos
 *     que (a) tengan la skill primaria requerida con nivel >= mínimo,
 *     (b) no sean el mismo usuario, (c) tengan slack ≥ effort de la
 *     task en algún día dentro del window ±N.
 *   - Tasks marcadas como "criticas" (priority CRITICAL o flag explícito)
 *     NO se reasignan.
 *   - Una task NO se reasigna 2 veces en la misma corrida.
 *
 * Determinismo: la iteración de inputs es estable (orden de userIds,
 * orden de tasks tal como vienen). Tests cubren empates (mismo nivel +
 * mismo slack).
 */

import { MS_PER_DAY, toIsoDay, type WorkloadResult } from './workload-calc'
import type { CapacityResult } from './capacity-calc'

export type RebalancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RebalanceTask {
  id: string
  title: string
  assigneeId: string
  /** Skill primaria requerida (nombre Skill.name). Opcional ⇒ no filtra. */
  primarySkill?: string
  /** Nivel mínimo de skill requerido (1-5). Default 1 (cualquier nivel sirve). */
  minSkillLevel?: number
  priority: RebalancePriority
  /** Horas/día que ocupa. Si null ⇒ usa `defaultDailyEffortHours`. */
  dailyEffortHours: number | null
  startDate: Date
  endDate: Date
  /** Si true, queda pinned y NO se reasigna aunque su prioridad sea baja. */
  pinned?: boolean
}

export interface UserSkillEntry {
  userId: string
  skillName: string
  level: number
}

export interface RebalanceInput {
  workload: WorkloadResult
  capacity: CapacityResult
  tasks: ReadonlyArray<RebalanceTask>
  userSkills: ReadonlyArray<UserSkillEntry>
  defaultDailyEffortHours?: number
  /** Ventana ± días donde buscar el "hueco". Default 5. */
  windowDays?: number
  /**
   * Tasks con priority en este set NO se reasignan (críticas). Default:
   * `['CRITICAL']`. Pasar `[]` permite reasignar incluso CRITICAL.
   */
  protectedPriorities?: ReadonlyArray<RebalancePriority>
}

export interface RebalanceSuggestion {
  taskId: string
  taskTitle: string
  fromUserId: string
  toUserId: string
  /** Día overloaded original que motivó la sugerencia. */
  triggerDay: string
  /** Razón legible para mostrar en UI/Tooltips. */
  rationale: string
  effortHours: number
}

export interface RebalanceResult {
  suggestions: RebalanceSuggestion[]
  /** Tasks con overload que no se pudieron rebalancear. */
  unresolved: Array<{
    taskId: string
    fromUserId: string
    triggerDay: string
    reason: 'NO_CANDIDATE' | 'PROTECTED' | 'PINNED'
  }>
}

interface CandidateScore {
  userId: string
  level: number
  slackDay: string
  slack: number
}

function buildSkillIndex(
  entries: ReadonlyArray<UserSkillEntry>,
): Map<string, Map<string, number>> {
  const idx = new Map<string, Map<string, number>>()
  for (const e of entries) {
    if (!e.userId || !e.skillName) continue
    let m = idx.get(e.skillName)
    if (!m) {
      m = new Map<string, number>()
      idx.set(e.skillName, m)
    }
    const prev = m.get(e.userId) ?? 0
    if (e.level > prev) m.set(e.userId, e.level)
  }
  return idx
}

function dayDelta(a: string, b: string): number {
  // ISO YYYY-MM-DD UTC midnight
  const da = Date.parse(`${a}T00:00:00.000Z`)
  const db = Date.parse(`${b}T00:00:00.000Z`)
  return Math.round((db - da) / MS_PER_DAY)
}

/**
 * Genera sugerencias de rebalanceo para reducir overload.
 *
 * Algoritmo paso a paso:
 *   1. Calcula la severidad de overload por (userId,day) y la ordena
 *      desc para procesar primero los hotspots.
 *   2. Por cada hotspot, recorre las tasks del usuario que contribuyen
 *      a ese día (ordenadas por priority asc — primero LOW/MEDIUM, luego
 *      HIGH; CRITICAL queda fuera por defecto).
 *   3. Por cada task no protegida:
 *        - Construye la lista de candidatos `userId` que (a) NO son
 *          el actual, (b) tienen la skill primaria con nivel >= min,
 *          (c) tienen slack ≥ effort en algún día del window ±N.
 *        - Si hay >1 candidato, gana primero el de mayor `level`,
 *          luego el de mayor `slack`, luego orden alfabético del id.
 *        - Si hay candidato ⇒ emite suggestion y marca la task como ya
 *          movida (no se reasigna 2 veces en la misma corrida).
 *        - Si no hay candidato ⇒ se anota en `unresolved`.
 *   4. Tras emitir una sugerencia, NO se actualizan los maps de carga
 *      (la sugerencia es propuesta — la confirma el usuario en UI).
 *      Cualquier hotspot subsiguiente sigue viendo el load original.
 */
export function suggestRebalance(input: RebalanceInput): RebalanceResult {
  const window = input.windowDays ?? 5
  const protectedSet = new Set<RebalancePriority>(
    input.protectedPriorities ?? ['CRITICAL'],
  )
  const defaultEffort = input.defaultDailyEffortHours ?? 8

  const skillIdx = buildSkillIndex(input.userSkills)
  const capByUserDay = new Map<string, Map<string, number>>()
  for (const c of input.capacity.byUser) {
    capByUserDay.set(c.userId, c.dailyCapacity)
  }
  const loadByUserDay = new Map<string, Map<string, number>>()
  for (const w of input.workload.byUser) {
    loadByUserDay.set(w.userId, w.dailyLoad)
  }

  // 1. Hotspots ordenados por severidad desc.
  interface Hotspot {
    userId: string
    day: string
    overload: number
  }
  const hotspots: Hotspot[] = []
  for (const w of input.workload.byUser) {
    const cap = capByUserDay.get(w.userId)
    if (!cap) continue
    for (const [day, hours] of w.dailyLoad) {
      const c = cap.get(day) ?? 0
      if (hours > c) {
        hotspots.push({ userId: w.userId, day, overload: hours - c })
      }
    }
  }
  hotspots.sort((a, b) => {
    if (b.overload !== a.overload) return b.overload - a.overload
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    return a.userId < b.userId ? -1 : 1
  })

  const taskById = new Map<string, RebalanceTask>()
  for (const t of input.tasks) taskById.set(t.id, t)
  const reassigned = new Set<string>()
  const suggestions: RebalanceSuggestion[] = []
  const unresolved: RebalanceResult['unresolved'] = []

  // Función para encontrar candidatos. Recibe la task y el día disparador.
  const findCandidates = (task: RebalanceTask, triggerDay: string): CandidateScore[] => {
    const effort = task.dailyEffortHours ?? defaultEffort
    const skillName = task.primarySkill
    const minLevel = task.minSkillLevel ?? 1
    const baseUsers: Array<{ userId: string; level: number }> = []
    if (skillName) {
      const m = skillIdx.get(skillName)
      if (!m) return []
      for (const [uid, lvl] of m) {
        if (uid === task.assigneeId) continue
        if (lvl < minLevel) continue
        baseUsers.push({ userId: uid, level: lvl })
      }
    } else {
      // Sin skill ⇒ todos los usuarios distintos del actual son candidatos.
      for (const w of input.workload.byUser) {
        if (w.userId === task.assigneeId) continue
        baseUsers.push({ userId: w.userId, level: 0 })
      }
    }
    const out: CandidateScore[] = []
    for (const cand of baseUsers) {
      const cap = capByUserDay.get(cand.userId)
      const load = loadByUserDay.get(cand.userId)
      if (!cap || !load) continue
      // Buscar dia con slack >= effort dentro del window
      let bestDay: string | null = null
      let bestSlack = -Infinity
      for (const [day, capH] of cap) {
        const delta = Math.abs(dayDelta(triggerDay, day))
        if (delta > window) continue
        const used = load.get(day) ?? 0
        const slack = capH - used
        if (slack >= effort && slack > bestSlack) {
          bestSlack = slack
          bestDay = day
        }
      }
      if (bestDay) {
        out.push({
          userId: cand.userId,
          level: cand.level,
          slackDay: bestDay,
          slack: bestSlack,
        })
      }
    }
    // Determinístico: nivel desc, slack desc, userId asc.
    out.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level
      if (b.slack !== a.slack) return b.slack - a.slack
      return a.userId < b.userId ? -1 : 1
    })
    return out
  }

  for (const hs of hotspots) {
    // Tasks del user que aporten al día.
    const wRow = input.workload.byUser.find((u) => u.userId === hs.userId)
    if (!wRow) continue
    const dayDetail = wRow.dailyDetail.find((d) => d.date === hs.day)
    if (!dayDetail) continue

    // Sort: NON-CRITICAL primero, dentro de éstos: LOW antes que HIGH.
    const PRI_ORDER: Record<RebalancePriority, number> = {
      LOW: 0,
      MEDIUM: 1,
      HIGH: 2,
      CRITICAL: 3,
    }
    const candidatesTasks = [...dayDetail.contributions]
      .map((c) => taskById.get(c.taskId))
      .filter((t): t is RebalanceTask => t !== undefined)
      .filter((t) => !reassigned.has(t.id))
      .sort((a, b) => PRI_ORDER[a.priority] - PRI_ORDER[b.priority])

    for (const task of candidatesTasks) {
      if (task.pinned) {
        unresolved.push({
          taskId: task.id,
          fromUserId: hs.userId,
          triggerDay: hs.day,
          reason: 'PINNED',
        })
        continue
      }
      if (protectedSet.has(task.priority)) {
        unresolved.push({
          taskId: task.id,
          fromUserId: hs.userId,
          triggerDay: hs.day,
          reason: 'PROTECTED',
        })
        continue
      }
      const cand = findCandidates(task, hs.day)
      if (cand.length === 0) {
        unresolved.push({
          taskId: task.id,
          fromUserId: hs.userId,
          triggerDay: hs.day,
          reason: 'NO_CANDIDATE',
        })
        continue
      }
      const winner = cand[0]
      if (!winner) continue
      const effort = task.dailyEffortHours ?? defaultEffort
      suggestions.push({
        taskId: task.id,
        taskTitle: task.title,
        fromUserId: hs.userId,
        toUserId: winner.userId,
        triggerDay: hs.day,
        effortHours: effort,
        rationale: task.primarySkill
          ? `Reasignar a ${winner.userId} (skill ${task.primarySkill} nivel ${winner.level}, holgura ${winner.slack.toFixed(1)}h en ${winner.slackDay}).`
          : `Reasignar a ${winner.userId} (holgura ${winner.slack.toFixed(1)}h en ${winner.slackDay}).`,
      })
      reassigned.add(task.id)
      // Sólo movemos UNA task por hotspot — el siguiente loop reevalúa.
      break
    }
  }

  return { suggestions, unresolved }
}

export { toIsoDay }
