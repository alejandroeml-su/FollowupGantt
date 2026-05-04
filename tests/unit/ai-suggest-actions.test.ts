import { describe, it, expect } from 'vitest'
import {
  suggestNextActions,
  type SuggestProjectInput,
  type SuggestTaskInput,
} from '@/lib/ai/suggest-actions'

/**
 * Ola P5 · Equipo P5-4 — Tests de `suggestNextActions`.
 *
 * Cada tipo de sugerencia se cubre de forma aislada y combinada.
 */

const NOW = new Date('2026-05-03T12:00:00Z')

function task(partial: Partial<SuggestTaskInput>): SuggestTaskInput {
  return {
    id: partial.id ?? 't1',
    title: partial.title ?? 'task',
    status: partial.status ?? 'IN_PROGRESS',
    progress: partial.progress ?? 0,
    assigneeId: partial.assigneeId ?? null,
    endDate: partial.endDate ?? null,
    updatedAt: partial.updatedAt ?? NOW,
    inCriticalPath: partial.inCriticalPath ?? false,
    baselineDriftDays: partial.baselineDriftDays ?? null,
  }
}

function project(partial: Partial<SuggestProjectInput>): SuggestProjectInput {
  return {
    id: partial.id ?? 'p1',
    name: partial.name ?? 'Proyecto',
    tasks: partial.tasks ?? [],
    sprints: partial.sprints,
  }
}

describe('suggestNextActions · proyecto vacío', () => {
  it('retorna lista vacía cuando no hay tareas', () => {
    expect(suggestNextActions(project({}), NOW)).toEqual([])
  })

  it('retorna lista vacía cuando todo está en orden', () => {
    const p = project({
      tasks: [
        task({
          id: 't1',
          assigneeId: 'u1',
          endDate: new Date('2026-06-01T00:00:00Z'),
        }),
      ],
    })
    expect(suggestNextActions(p, NOW)).toEqual([])
  })
})

describe('suggestNextActions · CP sin assignee', () => {
  it('detecta tareas en CP sin assignee', () => {
    const p = project({
      tasks: [
        task({ id: 't1', inCriticalPath: true, assigneeId: null }),
        task({ id: 't2', inCriticalPath: true, assigneeId: null }),
        task({ id: 't3', inCriticalPath: true, assigneeId: 'u1' }),
        task({ id: 't4', inCriticalPath: false, assigneeId: null }),
      ],
    })
    const actions = suggestNextActions(p, NOW)
    const cp = actions.find((a) => a.key === 'cp-without-assignee')
    expect(cp).toBeDefined()
    expect(cp?.count).toBe(2)
  })

  it('no aparece si todas las CP tienen assignee', () => {
    const p = project({
      tasks: [task({ id: 't1', inCriticalPath: true, assigneeId: 'u1' })],
    })
    expect(
      suggestNextActions(p, NOW).find((a) => a.key === 'cp-without-assignee'),
    ).toBeUndefined()
  })
})

describe('suggestNextActions · vencidas y stale', () => {
  it('detecta vencidas sin actualizar > 7 días', () => {
    const p = project({
      tasks: [
        task({
          id: 't1',
          endDate: new Date('2026-04-01T00:00:00Z'),
          updatedAt: new Date('2026-04-15T00:00:00Z'),
        }),
      ],
    })
    const stale = suggestNextActions(p, NOW).find((a) => a.key === 'overdue-stale')
    expect(stale).toBeDefined()
    expect(stale?.count).toBe(1)
  })

  it('NO marca vencidas si fueron actualizadas hace < 7 días', () => {
    const p = project({
      tasks: [
        task({
          id: 't1',
          endDate: new Date('2026-04-01T00:00:00Z'),
          updatedAt: new Date('2026-05-01T00:00:00Z'), // 2 días antes de NOW
        }),
      ],
    })
    expect(
      suggestNextActions(p, NOW).find((a) => a.key === 'overdue-stale'),
    ).toBeUndefined()
  })

  it('NO marca vencidas si la tarea está DONE', () => {
    const p = project({
      tasks: [
        task({
          id: 't1',
          status: 'DONE',
          endDate: new Date('2026-04-01T00:00:00Z'),
          updatedAt: new Date('2026-04-01T00:00:00Z'),
        }),
      ],
    })
    expect(
      suggestNextActions(p, NOW).find((a) => a.key === 'overdue-stale'),
    ).toBeUndefined()
  })
})

describe('suggestNextActions · baseline drift', () => {
  it('detecta tareas con drift > 5 días', () => {
    const p = project({
      tasks: [
        task({ id: 't1', baselineDriftDays: 7 }),
        task({ id: 't2', baselineDriftDays: 3 }),
        task({ id: 't3', baselineDriftDays: 6 }),
      ],
    })
    const drift = suggestNextActions(p, NOW).find((a) => a.key === 'baseline-drift')
    expect(drift?.count).toBe(2)
  })
})

describe('suggestNextActions · inconsistencias', () => {
  it('detecta tareas DONE con progress < 100', () => {
    const p = project({
      tasks: [
        task({ id: 't1', status: 'DONE', progress: 80 }),
        task({ id: 't2', status: 'DONE', progress: 100 }),
      ],
    })
    const inc = suggestNextActions(p, NOW).find(
      (a) => a.key === 'done-incoherent-progress',
    )
    expect(inc?.count).toBe(1)
  })

  it('detecta sprints activos sin capacity', () => {
    const p = project({
      tasks: [task({ id: 't1' })],
      sprints: [
        { id: 's1', name: 'Sprint 1', status: 'ACTIVE', capacity: null },
        { id: 's2', name: 'Sprint 2', status: 'ACTIVE', capacity: 20 },
        { id: 's3', name: 'Sprint 3', status: 'COMPLETED', capacity: null },
      ],
    })
    const sn = suggestNextActions(p, NOW).find((a) => a.key === 'sprint-no-capacity')
    expect(sn?.count).toBe(1)
  })
})

describe('suggestNextActions · agregaciones', () => {
  it('cap de 5 sugerencias máximas', () => {
    const p = project({
      tasks: [
        task({ id: 't1', inCriticalPath: true, assigneeId: null }),
        task({
          id: 't2',
          endDate: new Date('2026-03-01T00:00:00Z'),
          updatedAt: new Date('2026-03-01T00:00:00Z'),
        }),
        task({ id: 't3', baselineDriftDays: 10 }),
        task({ id: 't4', status: 'DONE', progress: 50 }),
      ],
      sprints: [{ id: 's1', name: 'S1', status: 'ACTIVE', capacity: null }],
    })
    const actions = suggestNextActions(p, NOW)
    expect(actions.length).toBeLessThanOrEqual(5)
    expect(actions.length).toBeGreaterThanOrEqual(4)
  })

  it('ordena por severity desc', () => {
    const p = project({
      tasks: [
        task({ id: 't1', inCriticalPath: true, assigneeId: null }),
        task({ id: 't2', status: 'DONE', progress: 50 }),
      ],
    })
    const actions = suggestNextActions(p, NOW)
    expect(actions[0].severity).toBeGreaterThanOrEqual(actions[1].severity)
  })

  it('determinismo: misma entrada → misma salida', () => {
    const p = project({
      tasks: [
        task({ id: 't1', inCriticalPath: true, assigneeId: null }),
        task({ id: 't2', baselineDriftDays: 10 }),
      ],
    })
    const a = suggestNextActions(p, NOW)
    const b = suggestNextActions(p, NOW)
    expect(a).toEqual(b)
  })
})
