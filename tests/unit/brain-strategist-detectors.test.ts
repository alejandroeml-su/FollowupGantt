/**
 * Wave P19-A · Tests unitarios para los 3 detectores puros del Brain
 * Strategist (resource contention, dependency conflicts, reusable lessons).
 *
 * Los detectores son funciones puras sin dependencias de Prisma · los
 * inputs ya vienen serializados desde `loadStrategistInputs()`. Esto
 * permite tests deterministas con fixtures inline.
 *
 * Cubre:
 *   - severity mapping (HIGH/MEDIUM/LOW) por umbrales
 *   - edge cases (sin solape, DONE filtrado, single user, empty input)
 *   - orden de salida (severity DESC + magnitud)
 */

import { describe, it, expect } from 'vitest'
import {
  detectResourceContention,
  detectDependencyConflicts,
  detectReusableLessons,
  type StrategistTaskInput,
  type StrategistCrossDepInput,
  type StrategistLessonInput,
} from '@/lib/brain/strategist/detectors'

// ─────────────────────────────────────────────────────────────────────
// Helpers / factories
// ─────────────────────────────────────────────────────────────────────

function isoDay(day: number, monthIndex = 0): string {
  // Helper centralizado · evita off-by-one por TZ usando Date.UTC.
  return new Date(Date.UTC(2026, monthIndex, day)).toISOString()
}

function makeTask(overrides: Partial<StrategistTaskInput> = {}): StrategistTaskInput {
  return {
    id: 't1',
    title: 'Task',
    projectId: 'p1',
    projectName: 'Project Alfa',
    assigneeId: 'u1',
    assigneeName: 'User One',
    startDate: isoDay(1),
    endDate: isoDay(10),
    dailyEffortHours: 4,
    status: 'IN_PROGRESS',
    ...overrides,
  }
}

function makeCrossDep(overrides: Partial<StrategistCrossDepInput> = {}): StrategistCrossDepInput {
  return {
    predecessorTaskId: 'pre1',
    predecessorTitle: 'Pre Task',
    predecessorProjectName: 'Project Alfa',
    predecessorEndDate: isoDay(10),
    successorTaskId: 'suc1',
    successorTitle: 'Suc Task',
    successorProjectName: 'Project Beta',
    successorStartDate: isoDay(15),
    ...overrides,
  }
}

function makeLesson(overrides: Partial<StrategistLessonInput> = {}): StrategistLessonInput {
  return {
    projectId: 'p1',
    projectName: 'Project Alfa',
    category: 'PROCESS',
    title: 'Use daily stand-ups',
    recommendation: 'Hold a 15min daily stand-up to unblock early.',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────
// detectResourceContention
// ─────────────────────────────────────────────────────────────────────

describe('detectResourceContention', () => {
  it('retorna array vacío con input vacío', () => {
    expect(detectResourceContention([])).toEqual([])
  })

  it('ignora task sin assigneeId', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', assigneeId: null }),
      makeTask({ id: 't2', projectId: 'p2', assigneeId: null }),
    ]
    expect(detectResourceContention(tasks)).toHaveLength(0)
  })

  it('ignora task sin startDate o endDate', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', startDate: null }),
      makeTask({ id: 't2', projectId: 'p2', endDate: null }),
    ]
    expect(detectResourceContention(tasks)).toHaveLength(0)
  })

  it('descarta tasks con status DONE', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', status: 'DONE' }),
      makeTask({ id: 't2', projectId: 'p2', status: 'DONE' }),
    ]
    expect(detectResourceContention(tasks)).toHaveLength(0)
  })

  it('no detecta contention cuando solo hay 1 task del usuario', () => {
    const tasks = [makeTask({ id: 't1', projectId: 'p1' })]
    expect(detectResourceContention(tasks)).toHaveLength(0)
  })

  it('no detecta contention cuando ambas tasks viven en el MISMO proyecto', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', startDate: isoDay(1), endDate: isoDay(10) }),
      makeTask({ id: 't2', projectId: 'p1', startDate: isoDay(5), endDate: isoDay(15) }),
    ]
    expect(detectResourceContention(tasks)).toHaveLength(0)
  })

  it('no detecta contention si las fechas NO se solapan (gap > 0)', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', startDate: isoDay(1), endDate: isoDay(5) }),
      makeTask({ id: 't2', projectId: 'p2', startDate: isoDay(10), endDate: isoDay(20) }),
    ]
    expect(detectResourceContention(tasks)).toHaveLength(0)
  })

  it('marca severity LOW para solape de 1-2 días', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', startDate: isoDay(1), endDate: isoDay(6) }),
      makeTask({
        id: 't2',
        projectId: 'p2',
        projectName: 'Project Beta',
        startDate: isoDay(5),
        endDate: isoDay(15),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights).toHaveLength(1)
    expect(insights[0].severity).toBe('LOW')
    expect(insights[0].overlapDays).toBeGreaterThan(0)
    expect(insights[0].overlapDays).toBeLessThan(3)
  })

  it('marca severity MEDIUM para solape entre 3 y 9 días', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', startDate: isoDay(1), endDate: isoDay(10) }),
      makeTask({
        id: 't2',
        projectId: 'p2',
        projectName: 'Project Beta',
        startDate: isoDay(4),
        endDate: isoDay(12),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights).toHaveLength(1)
    expect(insights[0].severity).toBe('MEDIUM')
    expect(insights[0].overlapDays).toBeGreaterThanOrEqual(3)
    expect(insights[0].overlapDays).toBeLessThan(10)
  })

  it('marca severity HIGH para solape >= 10 días', () => {
    const tasks = [
      makeTask({ id: 't1', projectId: 'p1', startDate: isoDay(1), endDate: isoDay(20) }),
      makeTask({
        id: 't2',
        projectId: 'p2',
        projectName: 'Project Beta',
        startDate: isoDay(5),
        endDate: isoDay(25),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights).toHaveLength(1)
    expect(insights[0].severity).toBe('HIGH')
    expect(insights[0].overlapDays).toBeGreaterThanOrEqual(10)
  })

  it('agrega proyectos múltiples en un mismo insight (3 proyectos solapados)', () => {
    const tasks = [
      makeTask({
        id: 't1',
        projectId: 'p1',
        projectName: 'Alfa',
        startDate: isoDay(1),
        endDate: isoDay(20),
      }),
      makeTask({
        id: 't2',
        projectId: 'p2',
        projectName: 'Beta',
        startDate: isoDay(5),
        endDate: isoDay(15),
      }),
      makeTask({
        id: 't3',
        projectId: 'p3',
        projectName: 'Gamma',
        startDate: isoDay(8),
        endDate: isoDay(18),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights).toHaveLength(1)
    expect(insights[0].projects.length).toBeGreaterThanOrEqual(3)
    // El recommendation debe mencionar 3 proyectos
    expect(insights[0].recommendation).toContain('3 proyectos')
  })

  it('separa contention por usuario (cada user emite su propio insight)', () => {
    const tasks = [
      makeTask({
        id: 't1',
        assigneeId: 'u1',
        assigneeName: 'Alice',
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(10),
      }),
      makeTask({
        id: 't2',
        assigneeId: 'u1',
        assigneeName: 'Alice',
        projectId: 'p2',
        startDate: isoDay(5),
        endDate: isoDay(15),
      }),
      makeTask({
        id: 't3',
        assigneeId: 'u2',
        assigneeName: 'Bob',
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(10),
      }),
      makeTask({
        id: 't4',
        assigneeId: 'u2',
        assigneeName: 'Bob',
        projectId: 'p3',
        startDate: isoDay(3),
        endDate: isoDay(12),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights).toHaveLength(2)
    const users = insights.map((i) => i.userId).sort()
    expect(users).toEqual(['u1', 'u2'])
  })

  it('ordena por severity DESC (HIGH antes que MEDIUM y LOW)', () => {
    const tasks = [
      // user1 → LOW (overlap 2 días)
      makeTask({
        id: 't1',
        assigneeId: 'u1',
        assigneeName: 'Alice',
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(6),
      }),
      makeTask({
        id: 't2',
        assigneeId: 'u1',
        assigneeName: 'Alice',
        projectId: 'p2',
        startDate: isoDay(5),
        endDate: isoDay(15),
      }),
      // user2 → HIGH (overlap 15 días)
      makeTask({
        id: 't3',
        assigneeId: 'u2',
        assigneeName: 'Bob',
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(20),
      }),
      makeTask({
        id: 't4',
        assigneeId: 'u2',
        assigneeName: 'Bob',
        projectId: 'p3',
        startDate: isoDay(5),
        endDate: isoDay(25),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights[0].severity).toBe('HIGH')
    expect(insights[insights.length - 1].severity).toBe('LOW')
  })

  it('usa userId como fallback de userName cuando assigneeName es null', () => {
    const tasks = [
      makeTask({
        id: 't1',
        assigneeId: 'u-anon',
        assigneeName: null,
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(10),
      }),
      makeTask({
        id: 't2',
        assigneeId: 'u-anon',
        assigneeName: null,
        projectId: 'p2',
        startDate: isoDay(5),
        endDate: isoDay(15),
      }),
    ]
    const insights = detectResourceContention(tasks)
    expect(insights).toHaveLength(1)
    expect(insights[0].userName).toBe('u-anon')
  })
})

// ─────────────────────────────────────────────────────────────────────
// detectDependencyConflicts
// ─────────────────────────────────────────────────────────────────────

describe('detectDependencyConflicts', () => {
  it('retorna array vacío con input vacío', () => {
    expect(detectDependencyConflicts([])).toEqual([])
  })

  it('ignora deps con predecessorEndDate null', () => {
    const deps = [makeCrossDep({ predecessorEndDate: null })]
    expect(detectDependencyConflicts(deps)).toEqual([])
  })

  it('ignora deps con successorStartDate null', () => {
    const deps = [makeCrossDep({ successorStartDate: null })]
    expect(detectDependencyConflicts(deps)).toEqual([])
  })

  it('NO emite insight cuando gap > 0 (sucesor empieza después)', () => {
    const deps = [
      makeCrossDep({
        predecessorEndDate: isoDay(10),
        successorStartDate: isoDay(20),
      }),
    ]
    expect(detectDependencyConflicts(deps)).toEqual([])
  })

  it('NO emite insight cuando gap = 0 (sucesor empieza justo al cerrar el predecesor)', () => {
    const deps = [
      makeCrossDep({
        predecessorEndDate: isoDay(10),
        successorStartDate: isoDay(10),
      }),
    ]
    // gap = 0 → no es schedule fail
    expect(detectDependencyConflicts(deps)).toEqual([])
  })

  it('detecta conflict severity LOW para gap entre -1 y -2 días', () => {
    const deps = [
      makeCrossDep({
        predecessorEndDate: isoDay(10),
        successorStartDate: isoDay(8),
      }),
    ]
    const insights = detectDependencyConflicts(deps)
    expect(insights).toHaveLength(1)
    expect(insights[0].severity).toBe('LOW')
    expect(insights[0].gapDays).toBeLessThan(0)
    expect(insights[0].gapDays).toBeGreaterThan(-3)
  })

  it('detecta conflict severity MEDIUM para gap entre -3 y -9 días', () => {
    const deps = [
      makeCrossDep({
        predecessorEndDate: isoDay(15),
        successorStartDate: isoDay(10),
      }),
    ]
    const insights = detectDependencyConflicts(deps)
    expect(insights).toHaveLength(1)
    expect(insights[0].severity).toBe('MEDIUM')
    expect(insights[0].gapDays).toBeLessThanOrEqual(-3)
    expect(insights[0].gapDays).toBeGreaterThan(-10)
  })

  it('detecta conflict severity HIGH para gap <= -10 días', () => {
    const deps = [
      makeCrossDep({
        predecessorEndDate: isoDay(25),
        successorStartDate: isoDay(10),
      }),
    ]
    const insights = detectDependencyConflicts(deps)
    expect(insights).toHaveLength(1)
    expect(insights[0].severity).toBe('HIGH')
    expect(insights[0].gapDays).toBeLessThanOrEqual(-10)
  })

  it('emite múltiples insights ordenados por gap más negativo primero', () => {
    const deps = [
      // gap = -2 → LOW
      makeCrossDep({
        predecessorTaskId: 'pre1',
        successorTaskId: 'suc1',
        predecessorEndDate: isoDay(10),
        successorStartDate: isoDay(8),
      }),
      // gap = -15 → HIGH (más negativo)
      makeCrossDep({
        predecessorTaskId: 'pre2',
        successorTaskId: 'suc2',
        predecessorEndDate: isoDay(25),
        successorStartDate: isoDay(10),
      }),
      // gap = -5 → MEDIUM
      makeCrossDep({
        predecessorTaskId: 'pre3',
        successorTaskId: 'suc3',
        predecessorEndDate: isoDay(15),
        successorStartDate: isoDay(10),
      }),
    ]
    const insights = detectDependencyConflicts(deps)
    expect(insights).toHaveLength(3)
    // Más negativo primero
    expect(insights[0].gapDays).toBeLessThan(insights[1].gapDays)
    expect(insights[1].gapDays).toBeLessThan(insights[2].gapDays)
    expect(insights[0].severity).toBe('HIGH')
  })

  it('incluye recommendation con el valor absoluto de los días', () => {
    const deps = [
      makeCrossDep({
        predecessorTitle: 'Diseñar API',
        successorTitle: 'Implementar frontend',
        predecessorEndDate: isoDay(15),
        successorStartDate: isoDay(8),
      }),
    ]
    const [insight] = detectDependencyConflicts(deps)
    // gap = -7
    expect(insight.recommendation).toContain('7')
    expect(insight.recommendation).toContain('Implementar frontend')
    expect(insight.recommendation).toContain('Diseñar API')
  })

  it('preserva project names en el shape de salida', () => {
    const deps = [
      makeCrossDep({
        predecessorProjectName: 'Alfa',
        successorProjectName: 'Beta',
        predecessorEndDate: isoDay(15),
        successorStartDate: isoDay(10),
      }),
    ]
    const [insight] = detectDependencyConflicts(deps)
    expect(insight.predecessor.project).toBe('Alfa')
    expect(insight.successor.project).toBe('Beta')
  })
})

// ─────────────────────────────────────────────────────────────────────
// detectReusableLessons
// ─────────────────────────────────────────────────────────────────────

describe('detectReusableLessons', () => {
  it('retorna array vacío sin lessons', () => {
    expect(detectReusableLessons([], ['Proyecto X'])).toEqual([])
  })

  it('retorna array vacío si no hay otros proyectos activos donde aplicar', () => {
    const lessons = [makeLesson({ projectName: 'Solo Project' })]
    expect(detectReusableLessons(lessons, ['Solo Project'])).toEqual([])
  })

  it('sugiere reusar lesson cuando hay otro proyecto activo distinto', () => {
    const lessons = [makeLesson({ projectName: 'Source Project', category: 'PROCESS' })]
    const insights = detectReusableLessons(lessons, ['Source Project', 'Target Project'])
    expect(insights).toHaveLength(1)
    expect(insights[0].sourceProject).toBe('Source Project')
    expect(insights[0].applicableProjects).toContain('Target Project')
    expect(insights[0].applicableProjects).not.toContain('Source Project')
  })

  it('todas las lessons tienen severity LOW', () => {
    const lessons = [
      makeLesson({ category: 'PROCESS' }),
      makeLesson({ category: 'TECHNICAL' }),
    ]
    const insights = detectReusableLessons(lessons, ['Project Alfa', 'Project Beta'])
    for (const ins of insights) {
      expect(ins.severity).toBe('LOW')
    }
  })

  it('agrupa lessons por categoría y emite 1 insight por categoría', () => {
    const lessons = [
      makeLesson({ category: 'PROCESS', title: 'Lesson 1' }),
      makeLesson({ category: 'PROCESS', title: 'Lesson 2' }),
      makeLesson({ category: 'TECHNICAL', title: 'Lesson 3' }),
    ]
    const insights = detectReusableLessons(lessons, ['Project Alfa', 'Project Beta'])
    const categories = insights.map((i) => i.category).sort()
    expect(categories).toEqual(['PROCESS', 'TECHNICAL'])
  })

  it('limita a máximo 10 insights de salida', () => {
    const lessons = Array.from({ length: 20 }, (_, i) =>
      makeLesson({ category: `CAT_${i}`, title: `Lesson ${i}` }),
    )
    const insights = detectReusableLessons(lessons, ['Project Alfa', 'Project Beta'])
    expect(insights.length).toBeLessThanOrEqual(10)
  })

  it('limita a máximo 5 proyectos aplicables por insight', () => {
    const lessons = [makeLesson({ projectName: 'Source', category: 'PROCESS' })]
    const many = ['Source', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']
    const [insight] = detectReusableLessons(lessons, many)
    expect(insight.applicableProjects.length).toBeLessThanOrEqual(5)
    expect(insight.applicableProjects).not.toContain('Source')
  })

  it('propaga el title y la recommendation de la lesson source', () => {
    const lessons = [
      makeLesson({
        projectName: 'Source',
        title: 'Code reviews diarios',
        recommendation: 'Hacer review antes de merge.',
      }),
    ]
    const [insight] = detectReusableLessons(lessons, ['Source', 'Target'])
    expect(insight.title).toBe('Code reviews diarios')
    expect(insight.recommendation).toBe('Hacer review antes de merge.')
  })
})
