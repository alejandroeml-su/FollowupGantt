/**
 * US-5.1 · Box View · UserBox — test de render del card individual.
 *
 * Verifica:
 *  - Renderiza nombre + rol
 *  - Renderiza métricas (activas/done/atrasadas)
 *  - Renderiza top-5 tareas
 *  - Link principal apunta a /list?assigneeId=<id>
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserBox, type UserBoxTaskView } from '@/components/box-view/UserBox'

const baseUser = {
  id: 'u1',
  name: 'Edwin Martinez',
  email: 'edwin@avante.test',
  image: null,
  role: 'ADMIN',
  activeSprint: {
    id: 's1',
    name: 'Sprint 12',
    startDate: '2026-05-10T00:00:00.000Z',
    endDate: '2026-05-24T00:00:00.000Z',
  },
  topEpic: {
    id: 'e1',
    name: 'Sync R3 GA',
    color: '#818cf8',
  },
}

function task(over: Partial<UserBoxTaskView> = {}): UserBoxTaskView {
  return {
    id: 't1',
    title: 'Refactor box view',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    progress: 40,
    startDate: '2026-05-12T00:00:00.000Z',
    endDate: '2026-05-25T00:00:00.000Z',
    sprintId: 's1',
    projectName: 'Sync',
    estimatedHours: 12,
    projectId: 'p1',
    epicId: 'e1',
    epicName: 'Sync R3 GA',
    epicColor: '#818cf8',
    ...over,
  }
}

describe('UserBox', () => {
  it('renderiza nombre, rol, sprint y métricas básicas', () => {
    render(
      <UserBox
        user={baseUser}
        tasks={[
          task({ id: 't1', status: 'IN_PROGRESS', progress: 40 }),
          task({ id: 't2', status: 'DONE', sprintId: 's1', progress: 100 }),
        ]}
      />,
    )

    expect(screen.getByText('Edwin Martinez')).toBeInTheDocument()
    expect(screen.getByText(/ADMIN/i)).toBeInTheDocument()
    expect(screen.getByText('Sprint 12')).toBeInTheDocument()
    expect(screen.getByText('Sync R3 GA')).toBeInTheDocument()

    // Métricas: 1 activa, 1 DONE en sprint actual, 0 atrasadas
    const activeDt = screen.getByText(/^Activas$/i)
    expect(activeDt.parentElement?.textContent).toMatch(/1/)

    const doneDt = screen.getByText(/^DONE$/i)
    expect(doneDt.parentElement?.textContent).toMatch(/1/)
  })

  it('apunta el overlay link al listado filtrado por assignee', () => {
    render(
      <UserBox
        user={baseUser}
        tasks={[task({ id: 't1', status: 'IN_PROGRESS' })]}
      />,
    )

    const link = screen.getByRole('link', {
      name: /Abrir tareas asignadas a Edwin Martinez/i,
    })
    expect(link).toHaveAttribute('href', '/list?assigneeId=u1')
  })

  it('renderiza tareas activas en el top y enlaza cada una al listado', () => {
    render(
      <UserBox
        user={baseUser}
        tasks={[
          task({ id: 't1', title: 'Refactor box view', status: 'IN_PROGRESS' }),
          task({ id: 't2', title: 'Done task', status: 'DONE', sprintId: 's1' }),
        ]}
      />,
    )

    const taskLink = screen.getByRole('link', { name: /Refactor box view/i })
    expect(taskLink.getAttribute('href')).toContain('/list?assigneeId=u1')
    expect(taskLink.getAttribute('href')).toContain('#task-t1')
    // La tarea DONE no debe aparecer en el top
    expect(
      screen.queryByRole('link', { name: /Done task/i }),
    ).not.toBeInTheDocument()
  })

  it('muestra mensaje vacío cuando no hay tareas activas', () => {
    render(
      <UserBox
        user={baseUser}
        tasks={[
          task({ id: 't1', status: 'DONE', sprintId: 's1' }),
        ]}
      />,
    )

    expect(
      screen.getByText(/Sin tareas activas en este filtro/i),
    ).toBeInTheDocument()
  })
})
