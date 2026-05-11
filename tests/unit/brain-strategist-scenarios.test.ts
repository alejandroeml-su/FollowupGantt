/**
 * Wave P19-B · Tests unitarios para el scenarios engine del Brain
 * Strategist (predictive delay simulation + auto-balancing).
 *
 * Helpers puros (sin Prisma) que reciben fixtures serializados y
 * devuelven resultados deterministas:
 *
 *   - simulateDelay: propaga un delay a través del grafo de
 *     dependencias (FS-only con lag, BFS con tope de 5000 iteraciones)
 *   - suggestRebalancing: clasifica usuarios overcommitted en 3
 *     patrones (transfer_load / overcommitted_user / reassign_to_available)
 *     y los ordena por severity DESC
 *
 * DEPENDENCIA: este archivo de tests asume que el módulo
 * `src/lib/brain/strategist/scenarios.ts` existe (PR #184 mergeado).
 * Si el código todavía NO está en master, los tests fallarán por
 * import; el deploy se debe hacer DESPUÉS de #184.
 */

import { describe, it, expect } from 'vitest'
import {
  simulateDelay,
  suggestRebalancing,
  type ScenarioTaskInput,
  type ScenarioDependencyInput,
  type AllocationUserInput,
} from '@/lib/brain/strategist/scenarios'

// ─────────────────────────────────────────────────────────────────────
// Helpers / factories
// ─────────────────────────────────────────────────────────────────────

function isoDay(day: number, monthIndex = 0): string {
  return new Date(Date.UTC(2026, monthIndex, day)).toISOString()
}

function makeScenarioTask(
  overrides: Partial<ScenarioTaskInput> = {},
): ScenarioTaskInput {
  return {
    id: 't1',
    title: 'Task',
    projectId: 'p1',
    projectName: 'Project Alfa',
    startDate: isoDay(1),
    endDate: isoDay(10),
    ...overrides,
  }
}

function makeUser(overrides: Partial<AllocationUserInput> = {}): AllocationUserInput {
  return {
    userId: 'u1',
    userName: 'Alice',
    totalDailyHours: 10,
    projects: [
      { projectId: 'p1', projectName: 'Project Alfa', spi: 1.0, taskCount: 3 },
    ],
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────
// simulateDelay
// ─────────────────────────────────────────────────────────────────────

describe('simulateDelay', () => {
  it('retorna resultado vacío si la sourceTaskId no existe en tasks', () => {
    const result = simulateDelay({
      sourceTaskId: 'ghost',
      delayDays: 5,
      tasks: [makeScenarioTask({ id: 't1' })],
      dependencies: [],
    })
    expect(result.sourceTaskId).toBe('ghost')
    expect(result.affected).toEqual([])
    expect(result.crossProjectAffected).toBe(0)
    expect(result.newProjectEndDate).toBeNull()
    expect(result.originalProjectEndDate).toBeNull()
  })

  it('retorna resultado vacío si la source no tiene endDate', () => {
    const tasks = [makeScenarioTask({ id: 't1', endDate: null })]
    const result = simulateDelay({
      sourceTaskId: 't1',
      delayDays: 5,
      tasks,
      dependencies: [],
    })
    expect(result.sourceTaskTitle).toBe(tasks[0].title)
    expect(result.affected).toEqual([])
  })

  it('incluye solo la task source si no hay dependencias', () => {
    const tasks = [makeScenarioTask({ id: 't1' })]
    const result = simulateDelay({
      sourceTaskId: 't1',
      delayDays: 5,
      tasks,
      dependencies: [],
    })
    expect(result.affected).toHaveLength(1)
    expect(result.affected[0].taskId).toBe('t1')
    expect(result.affected[0].deltaDays).toBe(5)
    expect(result.affected[0].depth).toBe(0)
    expect(result.crossProjectAffected).toBe(0)
  })

  it('propaga delay en cadena lineal A → B → C (depth se incrementa)', () => {
    // A: [1-10], B: [11-20], C: [21-30] con FS-0 lag.
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(11), endDate: isoDay(20) }),
      makeScenarioTask({ id: 'C', startDate: isoDay(21), endDate: isoDay(30) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
      { predecessorId: 'B', successorId: 'C', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 5,
      tasks,
      dependencies: deps,
    })
    expect(result.affected).toHaveLength(3)
    const byId = new Map(result.affected.map((a) => [a.taskId, a]))
    expect(byId.get('A')?.depth).toBe(0)
    expect(byId.get('B')?.depth).toBe(1)
    expect(byId.get('C')?.depth).toBe(2)
  })

  it('respeta lag positivo en propagación', () => {
    // A: [1-10], B: [16-25]. Si retrasamos A 3 días, B no debe moverse
    // si el lag de 5 días entre A.end y B.start sigue siendo respetado.
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(16), endDate: isoDay(25) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 5 },
    ]
    // A nuevo end = day 13, requiredStart = day 18 > day 16 → B shifts 2 días
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 3,
      tasks,
      dependencies: deps,
    })
    const b = result.affected.find((a) => a.taskId === 'B')
    expect(b).toBeDefined()
    expect(b!.deltaDays).toBeGreaterThan(0)
  })

  it('NO propaga si la dependencia ya está holgura-satisfecha (skip silencioso)', () => {
    // A: [1-10], B: [20-30] (gap 10 días). Retrasar A 5 días no afecta B.
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(20), endDate: isoDay(30) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 5,
      tasks,
      dependencies: deps,
    })
    // Solo la source aparece
    expect(result.affected).toHaveLength(1)
    expect(result.affected[0].taskId).toBe('A')
  })

  it('propaga a múltiples sucesores (fork A → B, A → C)', () => {
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(11), endDate: isoDay(20) }),
      makeScenarioTask({ id: 'C', startDate: isoDay(11), endDate: isoDay(20) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
      { predecessorId: 'A', successorId: 'C', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 3,
      tasks,
      dependencies: deps,
    })
    const ids = result.affected.map((a) => a.taskId).sort()
    expect(ids).toEqual(['A', 'B', 'C'])
  })

  it('en merge (B,C → D) usa el shift máximo cuando ambos preds afectan', () => {
    // A: [1-10], B: [1-15], C: [16-20]
    // Deps: A→C, B→C. Retraso A 20 días (shift muy grande, mayor que B).
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(1), endDate: isoDay(15) }),
      makeScenarioTask({ id: 'C', startDate: isoDay(16), endDate: isoDay(20) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'C', lagDays: 0 },
      { predecessorId: 'B', successorId: 'C', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 20,
      tasks,
      dependencies: deps,
    })
    const c = result.affected.find((a) => a.taskId === 'C')
    expect(c).toBeDefined()
    expect(c!.deltaDays).toBeGreaterThan(0)
  })

  it('cuenta cross-project impacts (crossProjectAffected) correctamente', () => {
    const tasks = [
      makeScenarioTask({
        id: 'A',
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(10),
      }),
      makeScenarioTask({
        id: 'B',
        projectId: 'p2', // otro proyecto
        startDate: isoDay(11),
        endDate: isoDay(20),
      }),
      makeScenarioTask({
        id: 'C',
        projectId: 'p1', // mismo proyecto que source
        startDate: isoDay(11),
        endDate: isoDay(20),
      }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
      { predecessorId: 'A', successorId: 'C', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 5,
      tasks,
      dependencies: deps,
    })
    // Solo B vive en p2 → 1 cross-project impact (C es intra-project)
    expect(result.crossProjectAffected).toBe(1)
  })

  it('source no cuenta como cross-project aunque depth=0', () => {
    const tasks = [
      makeScenarioTask({
        id: 'A',
        projectId: 'p1',
        startDate: isoDay(1),
        endDate: isoDay(10),
      }),
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 5,
      tasks,
      dependencies: [],
    })
    expect(result.crossProjectAffected).toBe(0)
  })

  it('ordena affected por deltaDays DESC', () => {
    // A delay 10, B delay 10, C delay 10 (con lag distinto en B)
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(11), endDate: isoDay(15) }),
      makeScenarioTask({ id: 'C', startDate: isoDay(16), endDate: isoDay(20) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
      { predecessorId: 'B', successorId: 'C', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 10,
      tasks,
      dependencies: deps,
    })
    // Ordenado por deltaDays DESC
    for (let i = 1; i < result.affected.length; i++) {
      expect(result.affected[i - 1].deltaDays).toBeGreaterThanOrEqual(
        result.affected[i].deltaDays,
      )
    }
  })

  it('calcula originalProjectEndDate como max endDate del input', () => {
    const tasks = [
      makeScenarioTask({ id: 'A', endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', endDate: isoDay(20) }),
      makeScenarioTask({ id: 'C', endDate: isoDay(15) }),
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 0,
      tasks,
      dependencies: [],
    })
    expect(result.originalProjectEndDate).toBe(isoDay(20))
  })

  it('calcula newProjectEndDate considerando shifts (>= original)', () => {
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(11), endDate: isoDay(15) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
    ]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 30,
      tasks,
      dependencies: deps,
    })
    const newEnd = new Date(result.newProjectEndDate!).getTime()
    const origEnd = new Date(result.originalProjectEndDate!).getTime()
    expect(newEnd).toBeGreaterThan(origEnd)
  })

  it('no entra en bucle infinito ante un ciclo en el grafo (safety cap)', () => {
    // A → B → C → A (ciclo)
    const tasks = [
      makeScenarioTask({ id: 'A', startDate: isoDay(1), endDate: isoDay(10) }),
      makeScenarioTask({ id: 'B', startDate: isoDay(11), endDate: isoDay(20) }),
      makeScenarioTask({ id: 'C', startDate: isoDay(21), endDate: isoDay(30) }),
    ]
    const deps: ScenarioDependencyInput[] = [
      { predecessorId: 'A', successorId: 'B', lagDays: 0 },
      { predecessorId: 'B', successorId: 'C', lagDays: 0 },
      { predecessorId: 'C', successorId: 'A', lagDays: 0 },
    ]
    // Debe terminar en tiempo razonable (capado a 5000 iteraciones)
    const start = Date.now()
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 10,
      tasks,
      dependencies: deps,
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2_000)
    expect(result.affected.length).toBeGreaterThan(0)
  })

  it('source siempre se incluye en affected con depth=0 y deltaDays=delayDays', () => {
    const tasks = [makeScenarioTask({ id: 'A' })]
    const result = simulateDelay({
      sourceTaskId: 'A',
      delayDays: 7,
      tasks,
      dependencies: [],
    })
    expect(result.affected[0].taskId).toBe('A')
    expect(result.affected[0].depth).toBe(0)
    expect(result.affected[0].deltaDays).toBe(7)
  })
})

// ─────────────────────────────────────────────────────────────────────
// suggestRebalancing
// ─────────────────────────────────────────────────────────────────────

describe('suggestRebalancing', () => {
  it('retorna array vacío sin users', () => {
    expect(suggestRebalancing([])).toEqual([])
  })

  it('ignora users con totalDailyHours <= 8.5h (no overcommitted)', () => {
    const users = [
      makeUser({ userId: 'u1', totalDailyHours: 6 }),
      makeUser({ userId: 'u2', totalDailyHours: 8.5 }),
    ]
    expect(suggestRebalancing(users)).toEqual([])
  })

  it('marca severity LOW para users entre 8.5h y 10h', () => {
    const users = [makeUser({ totalDailyHours: 9 })]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('LOW')
  })

  it('marca severity MEDIUM para users entre 10h y 12h', () => {
    const users = [makeUser({ totalDailyHours: 11 })]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('MEDIUM')
  })

  it('marca severity HIGH para users > 12h', () => {
    const users = [makeUser({ totalDailyHours: 13 })]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('HIGH')
  })

  it('clasifica como transfer_load cuando hay proyectos ahead Y behind', () => {
    const users = [
      makeUser({
        totalDailyHours: 10,
        projects: [
          { projectId: 'p1', projectName: 'Ahead', spi: 1.2, taskCount: 3 },
          { projectId: 'p2', projectName: 'Behind', spi: 0.8, taskCount: 3 },
        ],
      }),
    ]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('transfer_load')
    expect(out[0].recommendation).toContain('Ahead')
    expect(out[0].recommendation).toContain('Behind')
  })

  it('clasifica como overcommitted_user cuando TODOS los proyectos están atrasados', () => {
    const users = [
      makeUser({
        totalDailyHours: 11,
        projects: [
          { projectId: 'p1', projectName: 'P1', spi: 0.7, taskCount: 2 },
          { projectId: 'p2', projectName: 'P2', spi: 0.85, taskCount: 2 },
        ],
      }),
    ]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('overcommitted_user')
    expect(out[0].recommendation.toLowerCase()).toMatch(/burnout|reasignar|reasign/)
  })

  it('clasifica como reassign_to_available cuando SPI no es ahead/behind (default)', () => {
    const users = [
      makeUser({
        totalDailyHours: 9,
        projects: [
          { projectId: 'p1', projectName: 'P1', spi: 1.0, taskCount: 2 },
          { projectId: 'p2', projectName: 'P2', spi: null, taskCount: 2 },
        ],
      }),
    ]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('reassign_to_available')
  })

  it('reporta metrics.totalDailyHours, projectsInvolved y averageSpi', () => {
    const users = [
      makeUser({
        totalDailyHours: 10,
        projects: [
          { projectId: 'p1', projectName: 'P1', spi: 1.2, taskCount: 2 },
          { projectId: 'p2', projectName: 'P2', spi: 0.8, taskCount: 2 },
        ],
      }),
    ]
    const out = suggestRebalancing(users)
    expect(out[0].metrics.totalDailyHours).toBe(10)
    expect(out[0].metrics.projectsInvolved).toBe(2)
    expect(out[0].metrics.averageSpi).toBeCloseTo(1.0, 2)
  })

  it('ordena por severity DESC y luego por horas DESC', () => {
    const users = [
      makeUser({ userId: 'u1', userName: 'Low User', totalDailyHours: 9 }),
      makeUser({ userId: 'u2', userName: 'High User', totalDailyHours: 14 }),
      makeUser({ userId: 'u3', userName: 'Med User', totalDailyHours: 11 }),
    ]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(3)
    expect(out[0].severity).toBe('HIGH')
    expect(out[1].severity).toBe('MEDIUM')
    expect(out[2].severity).toBe('LOW')
  })

  it('ordena por horas DESC cuando hay empate de severity', () => {
    const users = [
      makeUser({ userId: 'u1', userName: 'A', totalDailyHours: 13 }),
      makeUser({ userId: 'u2', userName: 'B', totalDailyHours: 15 }),
      makeUser({ userId: 'u3', userName: 'C', totalDailyHours: 14 }),
    ]
    const out = suggestRebalancing(users)
    // Todos HIGH, orden por horas DESC: 15, 14, 13
    expect(out[0].metrics.totalDailyHours).toBe(15)
    expect(out[1].metrics.totalDailyHours).toBe(14)
    expect(out[2].metrics.totalDailyHours).toBe(13)
  })

  it('incluye userId y userName en cada sugerencia', () => {
    const users = [
      makeUser({ userId: 'u-x', userName: 'Carol', totalDailyHours: 10 }),
    ]
    const out = suggestRebalancing(users)
    expect(out[0].userId).toBe('u-x')
    expect(out[0].userName).toBe('Carol')
    expect(out[0].message).toContain('Carol')
  })

  it('maneja proyectos sin SPI (null) en el cálculo de averageSpi (toma default 1)', () => {
    const users = [
      makeUser({
        totalDailyHours: 9,
        projects: [
          { projectId: 'p1', projectName: 'P1', spi: null, taskCount: 1 },
          { projectId: 'p2', projectName: 'P2', spi: null, taskCount: 1 },
        ],
      }),
    ]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(1)
    // SPI null contributes 1.0 al promedio
    expect(out[0].metrics.averageSpi).toBeCloseTo(1.0, 2)
  })

  it('emite múltiples sugerencias (1 por usuario overcommitted)', () => {
    const users = [
      makeUser({ userId: 'u1', userName: 'A', totalDailyHours: 9 }),
      makeUser({ userId: 'u2', userName: 'B', totalDailyHours: 11 }),
      makeUser({ userId: 'u3', userName: 'C', totalDailyHours: 13 }),
      makeUser({ userId: 'u4', userName: 'D', totalDailyHours: 7 }), // NO overcommitted
    ]
    const out = suggestRebalancing(users)
    expect(out).toHaveLength(3)
    const ids = out.map((s) => s.userId).sort()
    expect(ids).toEqual(['u1', 'u2', 'u3'])
  })
})
