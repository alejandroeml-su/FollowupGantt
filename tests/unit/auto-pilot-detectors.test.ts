/**
 * Wave P20-C · Tests unitarios para los 4 detectores puros del Brain
 * Auto-Pilot (sprint rebalance · assignee rebalance · sprint extension ·
 * lesson promotion).
 *
 * Los detectores son funciones puras: inputs serializables, sin Prisma.
 * Cada caso verifica:
 *   - happy path (genera proposal con shape esperado)
 *   - edge / no-op (input que NO debe disparar el detector)
 */

import { describe, it, expect } from 'vitest'
import {
  detectSprintRebalance,
  detectAssigneeRebalance,
  detectSprintExtensionNeeded,
  detectLessonPromotion,
} from '@/lib/brain/auto-pilot/engine'
import type {
  AutoPilotDetectorInput,
  AutoPilotSprintInput,
  AutoPilotTaskInput,
  AutoPilotUserSkillInput,
  AutoPilotLessonInput,
} from '@/lib/brain/auto-pilot/types'

function isoDay(day: number, monthIndex = 0): string {
  return new Date(Date.UTC(2026, monthIndex, day)).toISOString()
}

function makeInput(overrides: Partial<AutoPilotDetectorInput> = {}): AutoPilotDetectorInput {
  return {
    sprints: [],
    tasks: [],
    users: [],
    lessons: [],
    workspaceId: 'ws-1',
    ...overrides,
  }
}

function makeSprint(o: Partial<AutoPilotSprintInput> = {}): AutoPilotSprintInput {
  return {
    id: 's1',
    name: 'Sprint 1',
    projectId: 'p1',
    projectName: 'Project Alfa',
    endDate: isoDay(14),
    capacity: 20,
    velocityP50: null,
    ...o,
  }
}

function makeTask(o: Partial<AutoPilotTaskInput> = {}): AutoPilotTaskInput {
  return {
    id: 't1',
    title: 'Task 1',
    projectId: 'p1',
    sprintId: 's1',
    assigneeId: 'u1',
    storyPoints: 5,
    status: 'TODO',
    ...o,
  }
}

function makeUser(o: Partial<AutoPilotUserSkillInput> = {}): AutoPilotUserSkillInput {
  return {
    userId: 'u1',
    userName: 'Alice',
    skillIds: ['skill-react'],
    currentLoad: 0,
    ...o,
  }
}

function makeLesson(o: Partial<AutoPilotLessonInput> = {}): AutoPilotLessonInput {
  return {
    id: 'l1',
    projectId: 'p1',
    projectName: 'Project Alfa',
    workspaceId: 'ws-1',
    category: 'PROCESS',
    title: 'Daily stand-ups',
    recommendation: 'Hold a 15min stand-up daily.',
    capturedAt: isoDay(1),
    ...o,
  }
}

// ─── detectSprintRebalance ──────────────────────────────────────────

describe('detectSprintRebalance', () => {
  it('propone mover tarea cuando sprint A está sobre-cargado y sprint B tiene holgura', () => {
    const sprintA = makeSprint({ id: 'a', name: 'Sprint A', endDate: isoDay(7), capacity: 20 })
    const sprintB = makeSprint({ id: 'b', name: 'Sprint B', endDate: isoDay(21), capacity: 20 })
    const overloadTasks = [
      makeTask({ id: 't1', sprintId: 'a', storyPoints: 13, title: 'Heavy' }),
      makeTask({ id: 't2', sprintId: 'a', storyPoints: 8, title: 'Small' }),
      makeTask({ id: 't3', sprintId: 'a', storyPoints: 8, title: 'Medium' }),
    ] // 29 SP vs cap 20 → 45% overload
    const lightTasks = [makeTask({ id: 't4', sprintId: 'b', storyPoints: 5 })]
    const out = detectSprintRebalance(makeInput({ sprints: [sprintA, sprintB], tasks: [...overloadTasks, ...lightTasks] }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('SPRINT_REBALANCE')
    expect(out[0].applyOps).toHaveLength(1)
    expect(out[0].applyOps[0].type).toBe('task.update')
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('no propone nada cuando todos los sprints están dentro de capacidad', () => {
    const sprintA = makeSprint({ id: 'a', capacity: 20 })
    const sprintB = makeSprint({ id: 'b', endDate: isoDay(21), capacity: 20 })
    const tasks = [
      makeTask({ id: 't1', sprintId: 'a', storyPoints: 10 }),
      makeTask({ id: 't2', sprintId: 'b', storyPoints: 5 }),
    ]
    const out = detectSprintRebalance(makeInput({ sprints: [sprintA, sprintB], tasks }))
    expect(out).toHaveLength(0)
  })
})

// ─── detectAssigneeRebalance ────────────────────────────────────────

describe('detectAssigneeRebalance', () => {
  it('propone reasignar cuando hay desbalance fuerte y skills compartidas', () => {
    const users = [
      makeUser({ userId: 'heavy', userName: 'Heavy', skillIds: ['ts', 'react'], currentLoad: 40 }),
      makeUser({ userId: 'light', userName: 'Light', skillIds: ['react'], currentLoad: 5 }),
    ]
    const tasks = [
      makeTask({ id: 'tA', assigneeId: 'heavy', storyPoints: 5, title: 'Pequeña' }),
      makeTask({ id: 'tB', assigneeId: 'heavy', storyPoints: 13 }),
    ]
    const out = detectAssigneeRebalance(makeInput({ users, tasks }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('ASSIGNEE_REBALANCE')
    expect(out[0].applyOps[0]).toMatchObject({ type: 'task.update', patch: { assigneeId: 'light' } })
  })

  it('no propone reasignación cuando no hay skills compartidas', () => {
    const users = [
      makeUser({ userId: 'a', skillIds: ['backend'], currentLoad: 40 }),
      makeUser({ userId: 'b', skillIds: ['design'], currentLoad: 5 }),
    ]
    const tasks = [makeTask({ assigneeId: 'a', storyPoints: 5 })]
    const out = detectAssigneeRebalance(makeInput({ users, tasks }))
    expect(out).toHaveLength(0)
  })
})

// ─── detectSprintExtensionNeeded ────────────────────────────────────

describe('detectSprintExtensionNeeded', () => {
  it('propone extender cuando scope supera velocity P50 histórica', () => {
    const sprint = makeSprint({ velocityP50: 20, endDate: isoDay(14) })
    const tasks = [
      makeTask({ storyPoints: 13 }),
      makeTask({ id: 't2', storyPoints: 13 }),
      makeTask({ id: 't3', storyPoints: 5 }),
    ] // 31 SP scope vs velocity 20 → 55% over
    const out = detectSprintExtensionNeeded(makeInput({ sprints: [sprint], tasks }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('SPRINT_EXTENSION')
    expect(out[0].applyOps[0]).toMatchObject({ type: 'sprint.update' })
    const op = out[0].applyOps[0]
    expect(op.type === 'sprint.update' && op.patch.endDate).toBeTruthy()
  })

  it('no propone extensión si no hay velocity histórica conocida', () => {
    const sprint = makeSprint({ velocityP50: null })
    const tasks = [makeTask({ storyPoints: 100 })]
    const out = detectSprintExtensionNeeded(makeInput({ sprints: [sprint], tasks }))
    expect(out).toHaveLength(0)
  })
})

// ─── detectLessonPromotion ──────────────────────────────────────────

describe('detectLessonPromotion', () => {
  it('propone promover lección cuando aparece en 2+ proyectos del mismo workspace', () => {
    const lessons = [
      makeLesson({ id: 'l1', projectId: 'p1', recommendation: 'Pair programming' }),
      makeLesson({ id: 'l2', projectId: 'p2', recommendation: 'Pair programming' }),
    ]
    const out = detectLessonPromotion(makeInput({ lessons }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('LESSON_PROMOTION')
    expect(out[0].applyOps[0]).toMatchObject({ type: 'workspace.upsert_global_template' })
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('no propone promoción si la lección viene de un solo proyecto', () => {
    const lessons = [
      makeLesson({ id: 'l1', projectId: 'p1', recommendation: 'Use docs' }),
      makeLesson({ id: 'l2', projectId: 'p1', recommendation: 'Use docs' }),
    ]
    const out = detectLessonPromotion(makeInput({ lessons }))
    expect(out).toHaveLength(0)
  })
})
