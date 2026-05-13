import { describe, it, expect } from 'vitest'
import {
  groupTasks,
  groupTasksMulti,
  type GroupKey,
} from '@/lib/views/group-tasks'
import { parseGrouping, isValidGrouping } from '@/lib/views/saved-view-types'
import type { SerializedTask } from '@/lib/types'

/**
 * Ola P2 · Equipo P2-1 — Tests del helper de agrupación dinámica.
 * Cubre todas las claves soportadas (assignee, status, priority, sprint,
 * phase, tags, custom_field) y los casos borde (sin agrupar, sin valor,
 * id desconocido, MULTI_SELECT multi-bucket).
 */

function makeTask(over: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id: over.id ?? 't' + Math.random(),
    title: 'Tarea',
    status: 'TODO',
    priority: 'MEDIUM',
    type: 'AGILE_STORY',
    progress: 0,
    tags: [],
    ...over,
  }
}

describe('groupTasks', () => {
  it('devuelve un solo grupo "Todas" cuando groupBy es null', () => {
    const tasks = [makeTask(), makeTask()]
    const groups = groupTasks(tasks, null)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    expect(groups[0].key).toBe('__all__')
  })

  it('agrupa por assignee con label desde users ctx', () => {
    const tasks = [
      makeTask({ id: 'a', assigneeId: 'u1', assignee: { id: 'u1', name: 'Ana' } }),
      makeTask({ id: 'b', assigneeId: 'u1', assignee: { id: 'u1', name: 'Ana' } }),
      makeTask({ id: 'c', assigneeId: undefined }),
    ]
    const groups = groupTasks(tasks, 'assignee', {
      users: [{ id: 'u1', name: 'Ana' }],
    })
    expect(groups).toHaveLength(2)
    const ana = groups.find((g) => g.key === 'u1')!
    expect(ana.count).toBe(2)
    expect(ana.label).toBe('Ana')
    // El "Sin asignar" debe estar al final.
    expect(groups[groups.length - 1].key).toBe('')
    expect(groups[groups.length - 1].label).toBe('Sin asignar')
  })

  it('agrupa por status en orden canónico TODO→DONE', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'DONE' }),
      makeTask({ id: 'b', status: 'TODO' }),
      makeTask({ id: 'c', status: 'IN_PROGRESS' }),
    ]
    const groups = groupTasks(tasks, 'status')
    expect(groups.map((g) => g.key)).toEqual(['TODO', 'IN_PROGRESS', 'DONE'])
  })

  it('agrupa por priority en orden CRITICAL→LOW', () => {
    const tasks = [
      makeTask({ id: 'a', priority: 'LOW' }),
      makeTask({ id: 'b', priority: 'CRITICAL' }),
      makeTask({ id: 'c', priority: 'MEDIUM' }),
    ]
    const groups = groupTasks(tasks, 'priority')
    expect(groups.map((g) => g.key)).toEqual(['CRITICAL', 'MEDIUM', 'LOW'])
    expect(groups.find((g) => g.key === 'CRITICAL')?.label).toBe('Crítica')
  })

  it('agrupa por sprint usando sprintId del registro genérico', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
    ]
    ;(tasks[0] as unknown as { sprintId: string }).sprintId = 's1'
    const groups = groupTasks(tasks, 'sprint', {
      sprints: [{ id: 's1', name: 'Sprint 1' }],
    })
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.key === 's1')?.label).toBe('Sprint 1')
    // tarea sin sprint cae a "Sin sprint" al final
    const last = groups[groups.length - 1]
    expect(last.key).toBe('')
    expect(last.label).toBe('Sin sprint')
  })

  it('agrupa por phase con fallback al id si la fase no está en ctx', () => {
    const tasks = [makeTask({ id: 'a' })]
    ;(tasks[0] as unknown as { phaseId: string }).phaseId = 'unknown-phase'
    const groups = groupTasks(tasks, 'phase', { phases: [] })
    expect(groups[0].key).toBe('unknown-phase')
    expect(groups[0].label).toBe('unknown-phase')
  })

  it('agrupa por tags en multi-bucket', () => {
    const tasks = [
      makeTask({ id: 'a', tags: ['frontend', 'urgent'] }),
      makeTask({ id: 'b', tags: ['frontend'] }),
      makeTask({ id: 'c', tags: [] }),
    ]
    const groups = groupTasks(tasks, 'tags')
    const front = groups.find((g) => g.key === 'frontend')!
    const urgent = groups.find((g) => g.key === 'urgent')!
    const sin = groups.find((g) => g.key === '')!
    expect(front.count).toBe(2)
    expect(urgent.count).toBe(1)
    expect(sin.label).toBe('Sin etiquetas')
    expect(sin.count).toBe(1)
  })

  it('agrupa por custom_field SELECT con label de opciones', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ]
    const groups = groupTasks(tasks, 'custom_field:cf1' as GroupKey, {
      customFields: [
        {
          id: 'cf1',
          label: 'Cliente',
          type: 'SELECT',
          options: [
            { value: 'avante', label: 'Avante' },
            { value: 'externo', label: 'Externo' },
          ],
        },
      ],
      customFieldValuesByTask: {
        a: { cf1: 'avante' },
        b: { cf1: 'avante' },
        c: { cf1: 'externo' },
      },
    })
    const avante = groups.find((g) => g.key === 'avante')!
    expect(avante.label).toBe('Avante')
    expect(avante.count).toBe(2)
    expect(groups.find((g) => g.key === 'externo')?.count).toBe(1)
  })

  it('agrupa por custom_field MULTI_SELECT en multi-bucket', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })]
    const groups = groupTasks(tasks, 'custom_field:cf1' as GroupKey, {
      customFields: [
        {
          id: 'cf1',
          label: 'Áreas',
          type: 'MULTI_SELECT',
          options: [
            { value: 'fin', label: 'Finanzas' },
            { value: 'rrhh', label: 'RRHH' },
          ],
        },
      ],
      customFieldValuesByTask: {
        a: { cf1: ['fin', 'rrhh'] },
        b: { cf1: ['fin'] },
      },
    })
    expect(groups.find((g) => g.key === 'fin')?.count).toBe(2)
    expect(groups.find((g) => g.key === 'rrhh')?.count).toBe(1)
  })

  it('cae a "Sin agrupar" si custom_field id no resuelve', () => {
    const tasks = [makeTask({ id: 'a' })]
    const groups = groupTasks(tasks, 'custom_field:missing' as GroupKey, {
      customFields: [],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('__all__')
    expect(groups[0].label).toContain('Sin agrupar')
  })

  it('emite "Sin valor" para custom_field cuando taskId no tiene valor', () => {
    const tasks = [makeTask({ id: 'a' })]
    const groups = groupTasks(tasks, 'custom_field:cf1' as GroupKey, {
      customFields: [
        { id: 'cf1', label: 'Importe', type: 'NUMBER' },
      ],
      customFieldValuesByTask: {},
    })
    expect(groups[0].key).toBe('')
    expect(groups[0].label).toContain('Sin valor')
  })

  it('cae a __all__ con groupKey desconocido', () => {
    const tasks = [makeTask({ id: 'a' })]
    // @ts-expect-error runtime guard
    const groups = groupTasks(tasks, 'unknownKey')
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('__all__')
  })

  it('agrupa por project usando project.name embebido', () => {
    const tasks = [
      makeTask({
        id: 'a',
        projectId: 'p1',
        project: { id: 'p1', name: 'Migración SAP' },
      }),
      makeTask({
        id: 'b',
        projectId: 'p1',
        project: { id: 'p1', name: 'Migración SAP' },
      }),
      makeTask({
        id: 'c',
        projectId: 'p2',
        project: { id: 'p2', name: 'SGC ISO 9001' },
      }),
      makeTask({ id: 'd', projectId: null }),
    ]
    const groups = groupTasks(tasks, 'project')
    const byKey = new Map(groups.map((g) => [g.key, g]))
    expect(byKey.get('p1')?.label).toBe('Migración SAP')
    expect(byKey.get('p1')?.tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(byKey.get('p2')?.label).toBe('SGC ISO 9001')
    expect(byKey.get('__no_project__')?.label).toBe('Sin proyecto')
    // El bucket "Sin proyecto" debe quedar al final.
    expect(groups[groups.length - 1].key).toBe('__no_project__')
  })

  it('agrupa por project usando ctx.projects cuando no hay project embebido', () => {
    const tasks = [
      makeTask({ id: 'a', projectId: 'p1' }),
      makeTask({ id: 'b', projectId: 'p1' }),
    ]
    const groups = groupTasks(tasks, 'project', {
      projects: [{ id: 'p1', name: 'Proyecto X' }],
    })
    expect(groups[0].label).toBe('Proyecto X')
  })
})

describe('groupTasksMulti (multi-nivel)', () => {
  it('keys=[] → un único grupo Todas (igual a single null)', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })]
    const tree = groupTasksMulti(tasks, [])
    expect(tree).toHaveLength(1)
    expect(tree[0].key).toBe('__all__')
    expect(tree[0].tasks).toHaveLength(2)
  })

  it('keys=[1] funciona como groupTasks single + tasks en hojas', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'TODO' }),
      makeTask({ id: 'b', status: 'DONE' }),
    ]
    const tree = groupTasksMulti(tasks, ['status'])
    expect(tree.map((g) => g.key)).toEqual(['TODO', 'DONE'])
    expect(tree[0].tasks?.map((t) => t.id)).toEqual(['a'])
    expect(tree[0].children).toBeUndefined()
  })

  it('keys=[status, priority] genera children con sub-buckets correctos', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'TODO', priority: 'HIGH' }),
      makeTask({ id: 'b', status: 'TODO', priority: 'LOW' }),
      makeTask({ id: 'c', status: 'DONE', priority: 'HIGH' }),
    ]
    const tree = groupTasksMulti(tasks, ['status', 'priority'])
    expect(tree).toHaveLength(2) // TODO + DONE
    const todo = tree.find((g) => g.key === 'TODO')!
    expect(todo.children).toBeDefined()
    expect(todo.tasks).toBeUndefined()
    const todoHigh = todo.children!.find((c) => c.key === 'HIGH')!
    const todoLow = todo.children!.find((c) => c.key === 'LOW')!
    expect(todoHigh.tasks?.map((t) => t.id)).toEqual(['a'])
    expect(todoLow.tasks?.map((t) => t.id)).toEqual(['b'])
    const done = tree.find((g) => g.key === 'DONE')!
    expect(done.children).toHaveLength(1)
    expect(done.children![0].tasks?.map((t) => t.id)).toEqual(['c'])
  })

  it('keys=[status, priority, assignee] 3 niveles funcionan', () => {
    const tasks = [
      makeTask({
        id: 'a',
        status: 'TODO',
        priority: 'HIGH',
        assigneeId: 'u1',
        assignee: { id: 'u1', name: 'Ana' },
      }),
      makeTask({
        id: 'b',
        status: 'TODO',
        priority: 'HIGH',
        assigneeId: 'u2',
        assignee: { id: 'u2', name: 'Bob' },
      }),
    ]
    const tree = groupTasksMulti(tasks, ['status', 'priority', 'assignee'])
    const todo = tree.find((g) => g.key === 'TODO')!
    const high = todo.children!.find((c) => c.key === 'HIGH')!
    expect(high.children).toHaveLength(2) // u1 + u2
    expect(high.children![0].tasks).toBeDefined()
  })
})

describe('parseGrouping / isValidGrouping (CSV multi)', () => {
  it('parseGrouping admite null/undefined/empty → []', () => {
    expect(parseGrouping(null)).toEqual([])
    expect(parseGrouping(undefined)).toEqual([])
    expect(parseGrouping('')).toEqual([])
  })

  it('parseGrouping admite string single → [single]', () => {
    expect(parseGrouping('assignee')).toEqual(['assignee'])
  })

  it('parseGrouping admite CSV → array', () => {
    expect(parseGrouping('status,assignee,priority')).toEqual([
      'status',
      'assignee',
      'priority',
    ])
  })

  it('parseGrouping admite array directo (compat futuro)', () => {
    expect(parseGrouping(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('isValidGrouping acepta keys conocidas y CSV de keys conocidas', () => {
    expect(isValidGrouping(null)).toBe(true)
    expect(isValidGrouping('')).toBe(true)
    expect(isValidGrouping('status')).toBe(true)
    expect(isValidGrouping('status,assignee')).toBe(true)
    expect(isValidGrouping('custom_field:abc-123')).toBe(true)
    expect(isValidGrouping('status,custom_field:abc-123,priority')).toBe(true)
  })

  it('isValidGrouping rechaza keys desconocidas en CSV', () => {
    expect(isValidGrouping('status,unknown_key')).toBe(false)
    expect(isValidGrouping('foo')).toBe(false)
  })
})
