import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Ola P2 · Equipo P2-4 — Tests de componente del `GoalCard`.
 */

import { GoalCard } from '@/components/goals/GoalCard'
import type { SerializedGoal } from '@/lib/actions/goals'

function makeGoal(overrides: Partial<SerializedGoal> = {}): SerializedGoal {
  return {
    id: 'g1',
    title: 'Lanzar nuevo onboarding',
    description: 'Reducir el time-to-value para clientes nuevos.',
    ownerId: 'u1',
    ownerName: 'Edwin Martinez',
    projectId: null,
    projectName: null,
    cycle: 'Q1-2026',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-03-31T00:00:00.000Z',
    status: 'ON_TRACK',
    parentId: null,
    progress: 60,
    keyResults: [
      {
        id: 'kr1',
        goalId: 'g1',
        title: 'NPS ≥ 50',
        metric: 'PERCENT',
        targetValue: 100,
        currentValue: 60,
        unit: '%',
        position: 1,
        progress: 60,
        linkedTaskCount: 0,
      },
      {
        id: 'kr2',
        goalId: 'g1',
        title: 'Cerrar 10 tareas',
        metric: 'TASKS_COMPLETED',
        targetValue: 100,
        currentValue: 50,
        unit: null,
        position: 2,
        progress: 50,
        linkedTaskCount: 4,
      },
    ],
    ...overrides,
  }
}

describe('GoalCard', () => {
  it('renderiza title, owner y badge ON_TRACK con label "On track"', () => {
    render(<GoalCard goal={makeGoal()} />)
    expect(screen.getByText(/Lanzar nuevo onboarding/i)).toBeInTheDocument()
    expect(screen.getByText('Edwin Martinez')).toBeInTheDocument()
    expect(screen.getByTestId('goal-status-badge')).toHaveTextContent(/On track/i)
  })

  it('muestra el badge "En riesgo" para AT_RISK', () => {
    render(<GoalCard goal={makeGoal({ status: 'AT_RISK' })} />)
    expect(screen.getByTestId('goal-status-badge')).toHaveTextContent(/En riesgo/i)
  })

  it('lista los KRs con su progreso y unidad cuando aplica', () => {
    render(<GoalCard goal={makeGoal()} />)
    const rows = screen.getAllByTestId('kr-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(/60%/)
    // KR de tipo TASKS_COMPLETED expone botón "Vincular tarea"
    expect(rows[1]).toHaveTextContent(/4 tareas vinculadas/i)
  })

  it('botón "Vincular tarea" aparece sólo en KRs TASKS_COMPLETED y dispara callback', async () => {
    const onLink = vi.fn()
    render(<GoalCard goal={makeGoal()} onLinkTaskRequest={onLink} />)
    const buttons = screen.getAllByTestId('kr-link-task-btn')
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    expect(onLink).toHaveBeenCalledWith('kr2')
  })

  it('toggle KRs colapsa/expande la lista', async () => {
    render(<GoalCard goal={makeGoal()} />)
    const toggle = screen.getByTestId('goal-toggle-krs')
    expect(screen.getByTestId('goal-krs-list')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.queryByTestId('goal-krs-list')).not.toBeInTheDocument()
  })
})
