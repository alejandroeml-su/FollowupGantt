import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { RiskMatrix } from '@/components/risks/RiskMatrix'
import type { SerializedRisk } from '@/lib/risks/types'

/**
 * Wave P8 · Equipo P8-2 — Tests de componente del `RiskMatrix`.
 *
 * Cubre:
 *   - Render de las 25 celdas con `data-tier`.
 *   - Conteo correcto por celda.
 *   - Click → callback con la celda seleccionada (toggle).
 *   - Risks CLOSED no se cuentan.
 *   - aria-pressed refleja el estado seleccionado.
 */

function makeRisk(overrides: Partial<SerializedRisk> = {}): SerializedRisk {
  return {
    id: overrides.id ?? 'r-' + Math.random().toString(36).slice(2),
    projectId: 'p1',
    projectName: 'Proyecto Demo',
    title: 'Riesgo demo',
    description: null,
    probability: 3,
    impact: 3,
    score: 9,
    tier: 'MEDIUM',
    status: 'OPEN',
    ownerId: null,
    ownerName: null,
    mitigation: null,
    triggerDelayDays: null,
    detectedAt: '2026-05-01T00:00:00.000Z',
    closedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('RiskMatrix', () => {
  it('renderiza 25 celdas (5×5)', () => {
    render(<RiskMatrix risks={[]} />)
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        expect(
          screen.getByTestId(`matrix-cell-${p}-${i}`),
        ).toBeInTheDocument()
      }
    }
  })

  it('cada celda tiene su tier correcto en data-tier', () => {
    render(<RiskMatrix risks={[]} />)
    expect(screen.getByTestId('matrix-cell-1-1')).toHaveAttribute(
      'data-tier',
      'LOW',
    )
    expect(screen.getByTestId('matrix-cell-3-4')).toHaveAttribute(
      'data-tier',
      'HIGH',
    )
    expect(screen.getByTestId('matrix-cell-5-5')).toHaveAttribute(
      'data-tier',
      'CRITICAL',
    )
    expect(screen.getByTestId('matrix-cell-1-5')).toHaveAttribute(
      'data-tier',
      'MEDIUM',
    )
  })

  it('cuenta correctamente risks por celda (P=3, I=4 → 2 risks)', () => {
    const risks = [
      makeRisk({ probability: 3, impact: 4 }),
      makeRisk({ probability: 3, impact: 4 }),
      makeRisk({ probability: 1, impact: 1 }),
    ]
    render(<RiskMatrix risks={risks} />)
    expect(screen.getByTestId('matrix-cell-3-4')).toHaveTextContent('2')
    expect(screen.getByTestId('matrix-cell-1-1')).toHaveTextContent('1')
    // Una celda sin risks tiene 0.
    expect(screen.getByTestId('matrix-cell-2-2')).toHaveTextContent('0')
  })

  it('NO cuenta risks con status CLOSED', () => {
    const risks = [
      makeRisk({ probability: 5, impact: 5, status: 'CLOSED' }),
      makeRisk({ probability: 5, impact: 5, status: 'OPEN' }),
    ]
    render(<RiskMatrix risks={risks} />)
    expect(screen.getByTestId('matrix-cell-5-5')).toHaveTextContent('1')
  })

  it('click en celda invoca onSelectCell con {probability, impact}', async () => {
    const onSelect = vi.fn()
    render(<RiskMatrix risks={[]} onSelectCell={onSelect} />)
    await userEvent.click(screen.getByTestId('matrix-cell-2-3'))
    expect(onSelect).toHaveBeenCalledWith({ probability: 2, impact: 3 })
  })

  it('click en celda ya seleccionada deselecciona (envía null)', async () => {
    const onSelect = vi.fn()
    render(
      <RiskMatrix
        risks={[]}
        selected={{ probability: 4, impact: 5 }}
        onSelectCell={onSelect}
      />,
    )
    const cell = screen.getByTestId('matrix-cell-4-5')
    expect(cell).toHaveAttribute('data-selected', 'true')
    expect(cell).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(cell)
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('aria-label es legible y contiene tier', () => {
    render(<RiskMatrix risks={[]} />)
    const cell = screen.getByTestId('matrix-cell-5-5')
    const label = cell.getAttribute('aria-label') ?? ''
    expect(label).toMatch(/Probabilidad 5/)
    expect(label).toMatch(/Impacto 5/)
    expect(label).toMatch(/Crítico/)
  })

  it('sin onSelectCell el click no rompe (no-op)', async () => {
    render(<RiskMatrix risks={[]} />)
    const cell = screen.getByTestId('matrix-cell-1-1')
    await userEvent.click(cell)
    // No assert: el click no debe lanzar.
    expect(cell).toBeInTheDocument()
  })
})
