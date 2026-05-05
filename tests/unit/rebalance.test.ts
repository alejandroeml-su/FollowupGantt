import { describe, it, expect } from 'vitest'
import {
  suggestRebalance,
  type RebalanceTask,
  type UserSkillEntry,
} from '@/lib/resources/rebalance'
import { computeWorkload } from '@/lib/resources/workload-calc'
import { computeCapacity } from '@/lib/resources/capacity-calc'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

interface BuildOpts {
  tasks: RebalanceTask[]
  userIds: string[]
  rangeStart?: Date
  rangeEnd?: Date
  calendarOverrides?: Record<string, { off?: string[]; dailyHours?: number }>
  defaultDailyEffortHours?: number
}

function buildScenario(opts: BuildOpts) {
  const rangeStart = opts.rangeStart ?? utc('2026-05-04')
  const rangeEnd = opts.rangeEnd ?? utc('2026-05-08')
  const def = opts.defaultDailyEffortHours ?? 8
  const workload = computeWorkload({
    userIds: opts.userIds,
    tasks: opts.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId,
      startDate: t.startDate,
      endDate: t.endDate,
      dailyEffortHours: t.dailyEffortHours,
    })),
    rangeStart,
    rangeEnd,
    defaultDailyEffortHours: def,
  })
  const capacity = computeCapacity({
    userIds: opts.userIds,
    rangeStart,
    rangeEnd,
    workdayHours: def,
    overrides: opts.calendarOverrides,
  })
  return { workload, capacity, rangeStart, rangeEnd, def }
}

describe('resources/rebalance · suggestRebalance', () => {
  it('no hay sugerencias si no hay overload', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'OK task',
      assigneeId: 'user-A',
      priority: 'MEDIUM',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-05'),
    }
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1],
      userSkills: [],
    })
    expect(result.suggestions).toEqual([])
    expect(result.unresolved).toEqual([])
  })

  it('sugiere reasignar a otro user con misma skill cuando hay overload', () => {
    // user-A: dos tasks que combinadas hacen 10h en mismo día (overload)
    // user-B: sin tasks → 8h de slack disponible (>= 4h del task que se mueve)
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Sobre cargado primary',
      assigneeId: 'user-A',
      primarySkill: 'react',
      minSkillLevel: 2,
      priority: 'MEDIUM',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const t2: RebalanceTask = {
      id: 't2',
      title: 'Otra tarea de A',
      assigneeId: 'user-A',
      priority: 'MEDIUM',
      dailyEffortHours: 6,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 3 },
      { userId: 'user-B', skillName: 'react', level: 4 },
    ]
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1, t2],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1, t2],
      userSkills: skills,
    })
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1)
    // La task con primarySkill react se reasigna a user-B (skill match).
    const suggestion = result.suggestions.find((s) => s.taskId === 't1')
    expect(suggestion?.toUserId).toBe('user-B')
  })

  it('NO sugiere reasignar tasks CRITICAL por defecto', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Crit',
      assigneeId: 'user-A',
      primarySkill: 'react',
      priority: 'CRITICAL',
      dailyEffortHours: 12,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 3 },
      { userId: 'user-B', skillName: 'react', level: 4 },
    ]
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1],
      userSkills: skills,
    })
    expect(result.suggestions).toEqual([])
    expect(result.unresolved[0]?.reason).toBe('PROTECTED')
  })

  it('respeta protectedPriorities custom', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'High',
      assigneeId: 'user-A',
      priority: 'HIGH',
      dailyEffortHours: 12,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1],
      userSkills: [],
      protectedPriorities: ['HIGH', 'CRITICAL'],
    })
    expect(result.suggestions).toEqual([])
    expect(result.unresolved[0]?.reason).toBe('PROTECTED')
  })

  it('marca PINNED cuando task.pinned=true', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Pin',
      assigneeId: 'user-A',
      priority: 'LOW',
      dailyEffortHours: 12,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
      pinned: true,
    }
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1],
      userSkills: [],
    })
    expect(result.suggestions).toEqual([])
    expect(result.unresolved[0]?.reason).toBe('PINNED')
  })

  it('NO_CANDIDATE si nadie tiene la skill requerida', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Solo',
      assigneeId: 'user-A',
      primarySkill: 'graphql',
      priority: 'MEDIUM',
      dailyEffortHours: 12,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'graphql', level: 5 },
      { userId: 'user-B', skillName: 'react', level: 4 },
    ]
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1],
      userSkills: skills,
    })
    expect(result.suggestions).toEqual([])
    expect(result.unresolved[0]?.reason).toBe('NO_CANDIDATE')
  })

  it('aplica filtro minSkillLevel', () => {
    // user-A overloaded con 2 tasks: el que se mueve es solo 4h ⇒ candidatos
    // necesitan ≥ 4h de slack, lo cual cumplen B y C (8h libres c/u).
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Senior task',
      assigneeId: 'user-A',
      primarySkill: 'react',
      minSkillLevel: 4,
      priority: 'MEDIUM',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const t2: RebalanceTask = {
      id: 't2',
      title: 'Filler',
      assigneeId: 'user-A',
      priority: 'MEDIUM',
      dailyEffortHours: 6,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 5 },
      { userId: 'user-B', skillName: 'react', level: 2 }, // muy junior, NO califica
      { userId: 'user-C', skillName: 'react', level: 4 }, // sí califica
    ]
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B', 'user-C'],
      tasks: [t1, t2],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1, t2],
      userSkills: skills,
    })
    const sugg = result.suggestions.find((s) => s.taskId === 't1')
    expect(sugg?.toUserId).toBe('user-C')
  })

  it('preferencia: nivel desc, slack desc, userId asc (determinístico)', () => {
    // Misma skill, mismo slack (todos vacíos) ⇒ gana mayor nivel (user-C).
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Tie',
      assigneeId: 'user-A',
      primarySkill: 'react',
      priority: 'MEDIUM',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const t2: RebalanceTask = {
      id: 't2',
      title: 'Filler',
      assigneeId: 'user-A',
      priority: 'MEDIUM',
      dailyEffortHours: 6,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 1 },
      { userId: 'user-B', skillName: 'react', level: 3 },
      { userId: 'user-C', skillName: 'react', level: 5 }, // este gana
    ]
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B', 'user-C'],
      tasks: [t1, t2],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1, t2],
      userSkills: skills,
    })
    const sugg = result.suggestions.find((s) => s.taskId === 't1')
    expect(sugg?.toUserId).toBe('user-C')
  })

  it('windowDays restringe la búsqueda de huecos', () => {
    // user-B tiene capacidad sólo después del window
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Cap window',
      assigneeId: 'user-A',
      primarySkill: 'react',
      priority: 'MEDIUM',
      dailyEffortHours: 12,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 3 },
      { userId: 'user-B', skillName: 'react', level: 3 },
    ]
    // user-B también tiene tasks ocupándolo todo dentro del window
    const tBlocker: RebalanceTask = {
      id: 'block',
      title: 'B blocked',
      assigneeId: 'user-B',
      priority: 'MEDIUM',
      dailyEffortHours: 8,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-15'),
    }
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1, tBlocker],
      rangeEnd: utc('2026-05-20'),
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1, tBlocker],
      userSkills: skills,
      windowDays: 5,
    })
    expect(result.unresolved.find((u) => u.taskId === 't1')?.reason).toBe(
      'NO_CANDIDATE',
    )
  })

  it('una task no se reasigna 2 veces aunque aporte a varios hotspots', () => {
    // user-A overloaded en 2 días por la misma task larga + filler.
    const tLong: RebalanceTask = {
      id: 't1',
      title: 'Long',
      assigneeId: 'user-A',
      primarySkill: 'react',
      priority: 'LOW',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-05'),
    }
    const tFiller: RebalanceTask = {
      id: 't2',
      title: 'Filler',
      assigneeId: 'user-A',
      priority: 'CRITICAL',
      dailyEffortHours: 6,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-05'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 3 },
      { userId: 'user-B', skillName: 'react', level: 4 },
    ]
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [tLong, tFiller],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [tLong, tFiller],
      userSkills: skills,
    })
    // tLong se reasigna sólo 1 vez aunque haya 2 hotspots (día 4 y 5).
    const longSuggestions = result.suggestions.filter((s) => s.taskId === 't1')
    expect(longSuggestions).toHaveLength(1)
  })

  it('sin primarySkill ⇒ cualquier user con holgura es candidato', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Generic',
      assigneeId: 'user-A',
      priority: 'MEDIUM',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const t2: RebalanceTask = {
      id: 't2',
      title: 'Filler',
      assigneeId: 'user-A',
      priority: 'CRITICAL',
      dailyEffortHours: 6,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const { workload, capacity } = buildScenario({
      userIds: ['user-A', 'user-B'],
      tasks: [t1, t2],
    })
    const result = suggestRebalance({
      workload,
      capacity,
      tasks: [t1, t2],
      userSkills: [],
    })
    const sugg = result.suggestions.find((s) => s.taskId === 't1')
    expect(sugg?.toUserId).toBe('user-B')
  })

  it('determinismo: 2 corridas idénticas ⇒ misma sugerencia', () => {
    const t1: RebalanceTask = {
      id: 't1',
      title: 'Det',
      assigneeId: 'user-A',
      primarySkill: 'react',
      priority: 'MEDIUM',
      dailyEffortHours: 4,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const t2: RebalanceTask = {
      id: 't2',
      title: 'Filler',
      assigneeId: 'user-A',
      priority: 'CRITICAL',
      dailyEffortHours: 6,
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-04'),
    }
    const skills: UserSkillEntry[] = [
      { userId: 'user-A', skillName: 'react', level: 3 },
      { userId: 'user-B', skillName: 'react', level: 4 },
      { userId: 'user-C', skillName: 'react', level: 4 },
    ]
    const scen1 = buildScenario({
      userIds: ['user-A', 'user-B', 'user-C'],
      tasks: [t1, t2],
    })
    const r1 = suggestRebalance({
      workload: scen1.workload,
      capacity: scen1.capacity,
      tasks: [t1, t2],
      userSkills: skills,
    })
    const scen2 = buildScenario({
      userIds: ['user-A', 'user-B', 'user-C'],
      tasks: [t1, t2],
    })
    const r2 = suggestRebalance({
      workload: scen2.workload,
      capacity: scen2.capacity,
      tasks: [t1, t2],
      userSkills: skills,
    })
    expect(r1).toEqual(r2)
  })
})
