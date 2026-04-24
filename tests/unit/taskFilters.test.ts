import { describe, it, expect } from 'vitest'
import type { SerializedTask } from '@/lib/types'
import {
  EMPTY_TASK_FILTERS,
  UNASSIGNED_VALUE,
  countActiveFilters,
  filterTasks,
  filterTasksWithSubtasks,
  hasActiveFilters,
  matchesFilters,
} from '@/lib/taskFilters'

function make(overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id: overrides.id ?? 't1',
    title: overrides.title ?? 'Tarea',
    status: overrides.status ?? 'TODO',
    priority: overrides.priority ?? 'MEDIUM',
    type: overrides.type ?? 'AGILE_STORY',
    progress: overrides.progress ?? 0,
    projectId: overrides.projectId ?? 'p1',
    assigneeId: overrides.assigneeId ?? null,
    areaId: overrides.areaId ?? null,
    gerenciaId: overrides.gerenciaId ?? null,
    subtasks: overrides.subtasks ?? [],
    ...overrides,
  }
}

describe('taskFilters · hasActiveFilters / countActiveFilters', () => {
  it('devuelve false y 0 cuando no hay filtros', () => {
    expect(hasActiveFilters(EMPTY_TASK_FILTERS)).toBe(false)
    expect(countActiveFilters(EMPTY_TASK_FILTERS)).toBe(0)
  })

  it('ignora strings vacíos', () => {
    expect(hasActiveFilters({ status: '' })).toBe(false)
    expect(countActiveFilters({ status: '', priority: undefined })).toBe(0)
  })

  it('cuenta sólo filtros con valor', () => {
    expect(countActiveFilters({ status: 'TODO', priority: 'HIGH' })).toBe(2)
  })
})

describe('taskFilters · matchesFilters', () => {
  it('respeta igualdad de status/priority/type', () => {
    const t = make({ status: 'DONE', priority: 'HIGH', type: 'PMI_TASK' })
    expect(matchesFilters(t, { status: 'DONE' })).toBe(true)
    expect(matchesFilters(t, { status: 'TODO' })).toBe(false)
    expect(matchesFilters(t, { priority: 'HIGH', type: 'PMI_TASK' })).toBe(true)
  })

  it('filtra por gerencia / area / proyecto', () => {
    const t = make({ gerenciaId: 'g1', areaId: 'a1', projectId: 'p1' })
    expect(matchesFilters(t, { gerenciaId: 'g1' })).toBe(true)
    expect(matchesFilters(t, { gerenciaId: 'g2' })).toBe(false)
    expect(matchesFilters(t, { areaId: 'a1', projectId: 'p1' })).toBe(true)
    expect(matchesFilters(t, { areaId: 'a2' })).toBe(false)
  })

  it('UNASSIGNED_VALUE matchea tareas sin responsable', () => {
    expect(matchesFilters(make({ assigneeId: null }), { assigneeId: UNASSIGNED_VALUE })).toBe(true)
    expect(matchesFilters(make({ assigneeId: 'u1' }), { assigneeId: UNASSIGNED_VALUE })).toBe(false)
  })

  it('filtro de assignee específico', () => {
    expect(matchesFilters(make({ assigneeId: 'u1' }), { assigneeId: 'u1' })).toBe(true)
    expect(matchesFilters(make({ assigneeId: 'u1' }), { assigneeId: 'u2' })).toBe(false)
  })
})

describe('taskFilters · filterTasks', () => {
  const list = [
    make({ id: 'a', status: 'TODO', priority: 'LOW', gerenciaId: 'g1' }),
    make({ id: 'b', status: 'DONE', priority: 'HIGH', gerenciaId: 'g1' }),
    make({ id: 'c', status: 'TODO', priority: 'HIGH', gerenciaId: 'g2' }),
  ]

  it('devuelve todo si no hay filtros', () => {
    expect(filterTasks(list, {})).toHaveLength(3)
  })

  it('combina filtros como AND', () => {
    const r = filterTasks(list, { status: 'TODO', priority: 'HIGH' })
    expect(r.map(t => t.id)).toEqual(['c'])
  })

  it('filtra por gerencia', () => {
    const r = filterTasks(list, { gerenciaId: 'g1' })
    expect(r.map(t => t.id).sort()).toEqual(['a', 'b'])
  })
})

describe('taskFilters · filterTasksWithSubtasks', () => {
  it('incluye padre si hay un hijo que coincide, aunque el padre no', () => {
    const parent = make({
      id: 'p',
      status: 'DONE',
      subtasks: [make({ id: 's1', status: 'TODO' })],
    })
    const r = filterTasksWithSubtasks([parent], { status: 'TODO' })
    expect(r).toHaveLength(1)
    expect(r[0].subtasks?.map(s => s.id)).toEqual(['s1'])
  })

  it('excluye padre si ni él ni ningún hijo coincide', () => {
    const parent = make({
      id: 'p',
      status: 'DONE',
      subtasks: [make({ id: 's1', status: 'DONE' })],
    })
    const r = filterTasksWithSubtasks([parent], { status: 'TODO' })
    expect(r).toHaveLength(0)
  })

  it('cuando el padre coincide, devuelve los hijos que también coinciden', () => {
    const parent = make({
      id: 'p',
      status: 'TODO',
      subtasks: [
        make({ id: 's1', status: 'TODO' }),
        make({ id: 's2', status: 'DONE' }),
      ],
    })
    const r = filterTasksWithSubtasks([parent], { status: 'TODO' })
    expect(r[0].subtasks?.map(s => s.id)).toEqual(['s1'])
  })
})
