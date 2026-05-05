import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  WorkloadChart,
  type WorkloadChartEntry,
} from '@/components/resources/WorkloadChart'

const baseDays = ['2026-05-04', '2026-05-05', '2026-05-06']

function makeEntry(over: Partial<WorkloadChartEntry> = {}): WorkloadChartEntry {
  return {
    userId: 'user-A',
    userName: 'Alice',
    dailyLoad: baseDays.map((d) => ({ date: d, hours: 4 })),
    dailyCapacity: baseDays.map((d) => ({ date: d, hours: 8 })),
    contributionsByDay: baseDays.map((d) => ({
      date: d,
      items: [{ taskId: 't1', taskTitle: 'Task A', hours: 4 }],
    })),
    totalOverloadHours: 0,
    totalOverloadDays: 0,
    peakDailyHours: 4,
    ...over,
  }
}

describe('WorkloadChart', () => {
  it('renderiza placeholder si entries vacío', () => {
    render(<WorkloadChart entries={[]} days={[]} />)
    expect(screen.getByTestId('workload-chart-empty')).toBeInTheDocument()
  })

  it('renderiza placeholder si days vacío', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={[]} />)
    expect(screen.getByTestId('workload-chart-empty')).toBeInTheDocument()
  })

  it('renderiza una fila por usuario', () => {
    render(
      <WorkloadChart
        entries={[makeEntry(), makeEntry({ userId: 'user-B', userName: 'Bob' })]}
        days={baseDays}
      />,
    )
    expect(screen.getByTestId('row-user-A')).toBeInTheDocument()
    expect(screen.getByTestId('row-user-B')).toBeInTheDocument()
  })

  it('muestra el nombre del usuario en la etiqueta', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={baseDays} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renderiza barras de capacidad y carga normales (azul, no rojo)', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={baseDays} />)
    const cap = screen.getByTestId('cap-user-A-2026-05-04')
    const load = screen.getByTestId('load-user-A-2026-05-04')
    expect(cap).toHaveAttribute('fill', '#1f2937')
    // Carga 4h sobre capacidad 8 ⇒ ratio 0.5 ⇒ azul
    expect(load).toHaveAttribute('fill', '#3b82f6')
  })

  it('renderiza barra de overload (rojo) cuando load > capacity', () => {
    const entry = makeEntry({
      dailyLoad: baseDays.map((d) => ({ date: d, hours: 12 })),
      totalOverloadDays: 3,
      totalOverloadHours: 12,
      peakDailyHours: 12,
    })
    render(<WorkloadChart entries={[entry]} days={baseDays} />)
    const overload = screen.getByTestId('overload-user-A-2026-05-04')
    expect(overload).toHaveAttribute('fill', '#dc2626')
  })

  it('muestra contador de días con sobrecarga en la etiqueta', () => {
    const entry = makeEntry({ totalOverloadDays: 2 })
    render(<WorkloadChart entries={[entry]} days={baseDays} />)
    expect(screen.getByText(/2d sobrecarga/i)).toBeInTheDocument()
  })

  it('muestra "sin sobrecarga" cuando totalOverloadDays = 0', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={baseDays} />)
    expect(screen.getByText(/sin sobrecarga/i)).toBeInTheDocument()
  })

  it('hover en una barra muestra el tooltip', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={baseDays} />)
    const bar = screen.getByTestId('bar-user-A-2026-05-04')
    fireEvent.mouseEnter(bar)
    const tooltip = screen.getByTestId('workload-chart-tooltip')
    expect(tooltip).toHaveTextContent(/2026-05-04/)
    expect(tooltip).toHaveTextContent(/Carga: 4.0h/)
    expect(tooltip).toHaveTextContent(/Task A/)
  })

  it('mouseLeave oculta el tooltip', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={baseDays} />)
    const bar = screen.getByTestId('bar-user-A-2026-05-04')
    fireEvent.mouseEnter(bar)
    expect(screen.getByTestId('workload-chart-tooltip')).toBeInTheDocument()
    fireEvent.mouseLeave(bar)
    expect(screen.queryByTestId('workload-chart-tooltip')).toBeNull()
  })

  it('SVG tiene aria-label accesible', () => {
    render(<WorkloadChart entries={[makeEntry()]} days={baseDays} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute(
      'aria-label',
      'Carga vs capacidad por día y usuario',
    )
  })
})
