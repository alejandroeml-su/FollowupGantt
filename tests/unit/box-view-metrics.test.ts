/**
 * US-5.1 · Box View — tests unitarios para cálculo de métricas por usuario.
 *
 * Pure-function tests sobre `computeBoxMetrics` y `pickTopTasks`.
 */

import { describe, it, expect } from 'vitest'
import {
  computeBoxMetrics,
  pickTopTasks,
  type BoxTaskInput,
} from '@/lib/box-view/metrics'

const NOW = new Date('2026-05-16T12:00:00.000Z')

function makeTask(overrides: Partial<BoxTaskInput> = {}): BoxTaskInput {
  return {
    id: 't1',
    title: 'Tarea base',
    status: 'TODO',
    priority: 'MEDIUM',
    progress: 0,
    startDate: null,
    endDate: null,
    sprintId: null,
    projectName: null,
    estimatedHours: null,
    ...overrides,
  }
}

describe('computeBoxMetrics', () => {
  it('cuenta activas (no DONE) y excluye DONE del progreso promedio', () => {
    const m = computeBoxMetrics({
      tasks: [
        makeTask({ id: 'a', status: 'IN_PROGRESS', progress: 50 }),
        makeTask({ id: 'b', status: 'REVIEW', progress: 80 }),
        makeTask({ id: 'c', status: 'DONE', progress: 100 }),
      ],
      activeSprintId: null,
      now: NOW,
    })

    expect(m.activeCount).toBe(2)
    expect(m.averageProgress).toBe(65) // (50+80)/2
  })

  it('cuenta DONE en sprint sólo si la tarea está enlazada al sprint activo', () => {
    const m = computeBoxMetrics({
      tasks: [
        makeTask({ id: 'a', status: 'DONE', sprintId: 'sprint-current' }),
        makeTask({ id: 'b', status: 'DONE', sprintId: 'sprint-old' }),
        makeTask({ id: 'c', status: 'DONE', sprintId: null }),
      ],
      activeSprintId: 'sprint-current',
      now: NOW,
    })

    expect(m.doneThisSprintCount).toBe(1)
    expect(m.activeCount).toBe(0)
    expect(m.averageProgress).toBeNull()
  })

  it('marca como atrasada solo tareas no-DONE con endDate < now', () => {
    const m = computeBoxMetrics({
      tasks: [
        // Atrasada (endDate antes de NOW y status IN_PROGRESS)
        makeTask({
          id: 'a',
          status: 'IN_PROGRESS',
          endDate: '2026-05-15T00:00:00.000Z',
        }),
        // Vence en futuro
        makeTask({
          id: 'b',
          status: 'TODO',
          endDate: '2026-05-20T00:00:00.000Z',
        }),
        // Pasada pero ya DONE → no cuenta como overdue
        makeTask({
          id: 'c',
          status: 'DONE',
          endDate: '2026-05-15T00:00:00.000Z',
          sprintId: 'sprint-current',
        }),
      ],
      activeSprintId: 'sprint-current',
      now: NOW,
    })

    expect(m.overdueCount).toBe(1)
  })

  it('suma horas estimadas sólo de tareas no-DONE y calcula utilización', () => {
    const m = computeBoxMetrics({
      tasks: [
        makeTask({ id: 'a', status: 'IN_PROGRESS', estimatedHours: 20 }),
        makeTask({ id: 'b', status: 'TODO', estimatedHours: 10 }),
        makeTask({ id: 'c', status: 'DONE', estimatedHours: 999 }),
        makeTask({ id: 'd', status: 'REVIEW', estimatedHours: null }),
      ],
      activeSprintId: null,
      now: NOW,
      weeklyCapacityHours: 40,
    })

    expect(m.assignedHours).toBe(30)
    expect(m.capacityHours).toBe(40)
    expect(m.utilization).toBe(0.75)
  })

  it('utilización ≥ 1 cuando hay sobreasignación', () => {
    const m = computeBoxMetrics({
      tasks: [
        makeTask({ id: 'a', status: 'IN_PROGRESS', estimatedHours: 50 }),
      ],
      activeSprintId: null,
      now: NOW,
      weeklyCapacityHours: 40,
    })

    expect(m.utilization).toBeGreaterThan(1)
    expect(m.utilization).toBeCloseTo(1.25, 5)
  })

  it('clampea progreso fuera de rango (defensivo)', () => {
    const m = computeBoxMetrics({
      tasks: [
        makeTask({ id: 'a', status: 'IN_PROGRESS', progress: -10 }),
        makeTask({ id: 'b', status: 'IN_PROGRESS', progress: 250 }),
      ],
      activeSprintId: null,
      now: NOW,
    })

    expect(m.averageProgress).toBe(50) // (0 + 100) / 2
  })

  it('regresa métricas vacías cuando no hay tareas', () => {
    const m = computeBoxMetrics({
      tasks: [],
      activeSprintId: null,
      now: NOW,
    })

    expect(m.activeCount).toBe(0)
    expect(m.doneThisSprintCount).toBe(0)
    expect(m.overdueCount).toBe(0)
    expect(m.averageProgress).toBeNull()
    expect(m.utilization).toBe(0)
  })
})

describe('pickTopTasks', () => {
  it('prioriza atrasadas primero, luego por prioridad y endDate', () => {
    const tasks: BoxTaskInput[] = [
      makeTask({
        id: 'low-future',
        priority: 'LOW',
        status: 'TODO',
        endDate: '2026-05-25T00:00:00.000Z',
      }),
      makeTask({
        id: 'critical-future',
        priority: 'CRITICAL',
        status: 'TODO',
        endDate: '2026-05-20T00:00:00.000Z',
      }),
      makeTask({
        id: 'overdue-low',
        priority: 'LOW',
        status: 'IN_PROGRESS',
        endDate: '2026-05-10T00:00:00.000Z',
      }),
      makeTask({
        id: 'done',
        priority: 'CRITICAL',
        status: 'DONE',
        endDate: '2026-05-09T00:00:00.000Z',
      }),
    ]

    const top = pickTopTasks(tasks, NOW)
    // DONE se filtra; el primero debe ser el overdue, luego critical-future
    expect(top.map((t) => t.id)).toEqual([
      'overdue-low',
      'critical-future',
      'low-future',
    ])
  })

  it('respeta el limit', () => {
    const tasks: BoxTaskInput[] = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `t${i}`, status: 'TODO' }),
    )
    expect(pickTopTasks(tasks, NOW, 3).length).toBe(3)
  })
})
