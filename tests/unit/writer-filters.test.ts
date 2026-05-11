import { describe, it, expect } from 'vitest'
import type { WriterFilterOptions } from '@/lib/brain/writer-types'

/**
 * Lógica de cascada para los filtros del Writer AI.
 *
 * La UI selecciona Proyecto → Épica → Sprint → Historia de usuario. Cada
 * filtro estrecha la lista del siguiente. Estos tests son puros: replican
 * el `useMemo` del componente y no requieren montar React.
 */

function applyCascade(
  options: WriterFilterOptions,
  filter: { projectId: string; epicId: string; sprintId: string },
) {
  const epics = filter.projectId
    ? options.epics.filter((e) => e.projectId === filter.projectId)
    : []
  const sprints = filter.projectId
    ? options.sprints.filter((s) => s.projectId === filter.projectId)
    : []
  const stories = filter.projectId
    ? options.userStories.filter((t) => {
        if (t.projectId !== filter.projectId) return false
        if (filter.epicId && t.epicId !== filter.epicId) return false
        if (filter.sprintId && t.sprintId !== filter.sprintId) return false
        return true
      })
    : []
  return { epics, sprints, stories }
}

const FIXTURE: WriterFilterOptions = {
  projects: [
    { id: 'p1', name: 'Proyecto Alfa' },
    { id: 'p2', name: 'Proyecto Beta' },
  ],
  epics: [
    { id: 'e1', name: 'Onboarding', projectId: 'p1' },
    { id: 'e2', name: 'Pagos', projectId: 'p1' },
    { id: 'e3', name: 'Mobile', projectId: 'p2' },
  ],
  sprints: [
    { id: 's1', name: 'Sprint 1', projectId: 'p1', status: 'ACTIVE' },
    { id: 's2', name: 'Sprint 2', projectId: 'p1', status: 'PLANNING' },
    { id: 's3', name: 'Sprint A', projectId: 'p2', status: 'ACTIVE' },
  ],
  userStories: [
    { id: 't1', mnemonic: 'ALFA-1', title: 'Login con email', projectId: 'p1', epicId: 'e1', sprintId: 's1' },
    { id: 't2', mnemonic: 'ALFA-2', title: 'Recordar contraseña', projectId: 'p1', epicId: 'e1', sprintId: 's2' },
    { id: 't3', mnemonic: 'ALFA-3', title: 'Cobrar suscripción', projectId: 'p1', epicId: 'e2', sprintId: 's1' },
    { id: 't4', mnemonic: 'BETA-1', title: 'Push iOS', projectId: 'p2', epicId: 'e3', sprintId: 's3' },
    { id: 't5', mnemonic: 'ALFA-4', title: 'Historia sin sprint', projectId: 'p1', epicId: 'e1', sprintId: null },
  ],
}

describe('Writer AI · cascade filters', () => {
  it('sin proyecto seleccionado, todas las listas dependientes están vacías', () => {
    const { epics, sprints, stories } = applyCascade(FIXTURE, {
      projectId: '',
      epicId: '',
      sprintId: '',
    })
    expect(epics).toHaveLength(0)
    expect(sprints).toHaveLength(0)
    expect(stories).toHaveLength(0)
  })

  it('al seleccionar proyecto, las épicas y sprints filtran por projectId', () => {
    const { epics, sprints, stories } = applyCascade(FIXTURE, {
      projectId: 'p1',
      epicId: '',
      sprintId: '',
    })
    expect(epics.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(sprints.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(stories.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3', 't5'])
  })

  it('al seleccionar épica, las historias se restringen a esa épica', () => {
    const { stories } = applyCascade(FIXTURE, {
      projectId: 'p1',
      epicId: 'e1',
      sprintId: '',
    })
    expect(stories.map((t) => t.id).sort()).toEqual(['t1', 't2', 't5'])
  })

  it('al seleccionar sprint, las historias se restringen a ese sprint', () => {
    const { stories } = applyCascade(FIXTURE, {
      projectId: 'p1',
      epicId: '',
      sprintId: 's1',
    })
    expect(stories.map((t) => t.id).sort()).toEqual(['t1', 't3'])
  })

  it('combinando épica + sprint, las historias deben coincidir con ambas', () => {
    const { stories } = applyCascade(FIXTURE, {
      projectId: 'p1',
      epicId: 'e1',
      sprintId: 's1',
    })
    expect(stories.map((t) => t.id)).toEqual(['t1'])
  })

  it('cambiar de proyecto reinicia la lista de épicas y sprints', () => {
    const beta = applyCascade(FIXTURE, {
      projectId: 'p2',
      epicId: '',
      sprintId: '',
    })
    expect(beta.epics.map((e) => e.id)).toEqual(['e3'])
    expect(beta.sprints.map((s) => s.id)).toEqual(['s3'])
    expect(beta.stories.map((t) => t.id)).toEqual(['t4'])
  })

  it('historias sin sprint (sprintId null) se filtran al pedir un sprint específico', () => {
    const { stories } = applyCascade(FIXTURE, {
      projectId: 'p1',
      epicId: 'e1',
      sprintId: 's2',
    })
    expect(stories.map((t) => t.id)).toEqual(['t2'])
  })
})
