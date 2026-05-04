import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * Equipo D3 · Tests del ExecutiveDashboard.
 *
 * Cubre:
 *   - Render de KPIs.
 *   - Render de PortfolioHealthCard con semáforo.
 *   - Render del greeting según hora.
 *   - RiskHotspotsCard (incluye empty state).
 *   - UpcomingMilestonesCard etiquetado de urgencia.
 *   - EVMSnapshotCard con avg SPI / CPI.
 *
 * Mockear `dismissInsight` por si AINextActionsCard se monta.
 */

import { ExecutiveDashboard } from '@/components/dashboard/ExecutiveDashboard'
import { RiskHotspotsCard } from '@/components/dashboard/RiskHotspotsCard'
import { UpcomingMilestonesCard } from '@/components/dashboard/UpcomingMilestonesCard'
import { EVMSnapshotCard } from '@/components/dashboard/EVMSnapshotCard'
import { PortfolioHealthCard } from '@/components/dashboard/PortfolioHealthCard'
import type { PortfolioReport } from '@/lib/reports/portfolio'

function makePortfolio(): PortfolioReport {
  return {
    generatedAt: new Date('2026-05-04T10:00:00Z').toISOString(),
    rows: [
      {
        id: 'p1',
        name: 'Proyecto SAP',
        status: 'ACTIVE',
        evm: {
          pv: 100,
          ev: 90,
          ac: 110,
          sv: -10,
          cv: -20,
          spi: 0.9,
          cpi: 0.82,
          bac: 200,
          eac: 244,
          vac: -44,
          asOf: new Date('2026-05-04T10:00:00Z').toISOString(),
          taskCount: 5,
          budgetedTaskCount: 4,
          acIsEstimated: false,
          perTask: [],
        },
        progressPercent: 45,
        totalTasks: 5,
        completedTasks: 2,
        nextMilestone: null,
        health: 'red',
        cv: -20,
        spi: 0.9,
        cpi: 0.82,
      },
      {
        id: 'p2',
        name: 'Proyecto CRM',
        status: 'ACTIVE',
        evm: null,
        progressPercent: 10,
        totalTasks: 3,
        completedTasks: 0,
        nextMilestone: null,
        health: 'gray',
        cv: null,
        spi: null,
        cpi: null,
      },
    ],
    summary: {
      totalProjects: 2,
      healthBreakdown: { green: 0, yellow: 0, red: 1, gray: 1 },
      activeProjects: 2,
      completedProjects: 0,
      avgProgress: 28,
      avgSPI: 0.9,
      avgCPI: 0.82,
    },
  }
}

const baseData = (over: Partial<{
  portfolio: PortfolioReport
  topRisks: Parameters<typeof RiskHotspotsCard>[0]['items']
  upcomingMilestones: Parameters<typeof UpcomingMilestonesCard>[0]['items']
  nextActions: Parameters<typeof import('@/components/dashboard/AINextActionsCard').AINextActionsCard>[0]['items']
  delayedTaskCount: number
}> = {}) => ({
  portfolio: over.portfolio ?? makePortfolio(),
  topRisks: over.topRisks ?? [],
  upcomingMilestones: over.upcomingMilestones ?? [],
  nextActions: over.nextActions ?? [],
  delayedTaskCount: over.delayedTaskCount ?? 0,
})

describe('ExecutiveDashboard', () => {
  it('renderiza el saludo según la hora del día (mañana)', () => {
    const morning = new Date('2026-05-04T08:00:00')
    render(
      <ExecutiveDashboard
        userName="Edwin Martinez"
        data={baseData()}
        now={morning}
      />,
    )
    expect(screen.getByText(/Buenos días/)).toBeInTheDocument()
    expect(screen.getByText(/Edwin/)).toBeInTheDocument()
  })

  it('renderiza el saludo según la hora del día (noche)', () => {
    const night = new Date('2026-05-04T22:00:00')
    render(
      <ExecutiveDashboard
        userName="Edwin Martinez"
        data={baseData()}
        now={night}
      />,
    )
    expect(screen.getByText(/Buenas noches/)).toBeInTheDocument()
  })

  it('muestra los 4 KPIs con valores correctos', () => {
    render(
      <ExecutiveDashboard
        userName="Edwin"
        data={baseData({ delayedTaskCount: 7 })}
        now={new Date('2026-05-04T10:00:00')}
      />,
    )
    expect(screen.getByTestId('kpi-active-projects')).toHaveTextContent('2')
    expect(screen.getByTestId('kpi-delayed-tasks')).toHaveTextContent('7')
    expect(screen.getByTestId('kpi-completion')).toHaveTextContent('28%')
  })

  it('renderiza la PortfolioHealthCard con el listado de proyectos', () => {
    render(
      <ExecutiveDashboard
        userName="Edwin"
        data={baseData()}
        now={new Date('2026-05-04T10:00:00')}
      />,
    )
    const card = screen.getByTestId('portfolio-health-card')
    expect(within(card).getByText(/Proyecto SAP/)).toBeInTheDocument()
    expect(within(card).getByText(/Proyecto CRM/)).toBeInTheDocument()
    // Barra con segmentos red + gray (no green ni yellow porque count=0)
    expect(screen.getByTestId('portfolio-health-bar-red')).toBeInTheDocument()
    expect(screen.getByTestId('portfolio-health-bar-gray')).toBeInTheDocument()
  })
})

describe('PortfolioHealthCard', () => {
  it('muestra empty state cuando no hay proyectos', () => {
    render(
      <PortfolioHealthCard
        rows={[]}
        summary={{
          totalProjects: 0,
          healthBreakdown: { green: 0, yellow: 0, red: 0, gray: 0 },
        }}
      />,
    )
    expect(
      screen.getByText(/Aún no hay proyectos en el portafolio/),
    ).toBeInTheDocument()
  })
})

describe('RiskHotspotsCard', () => {
  it('renderiza vacío cuando no hay riesgos', () => {
    render(<RiskHotspotsCard items={[]} />)
    expect(screen.getByText(/Sin riesgos detectados/)).toBeInTheDocument()
  })

  it('lista hasta 5 riesgos con score y nivel', () => {
    render(
      <RiskHotspotsCard
        items={[
          {
            taskId: 't1',
            taskTitle: 'Definir alcance',
            projectId: 'p1',
            projectName: 'SAP',
            score: 0.85,
            level: 'high',
            factors: ['fechas vencidas'],
          },
          {
            taskId: 't2',
            taskTitle: 'Validar requerimientos',
            projectId: 'p1',
            projectName: 'SAP',
            score: 0.62,
            level: 'medium',
            factors: [],
          },
        ]}
      />,
    )
    expect(screen.getByTestId('risk-hotspot-t1')).toBeInTheDocument()
    expect(screen.getByText(/85%/)).toBeInTheDocument()
    expect(screen.getByText(/Definir alcance/)).toBeInTheDocument()
    expect(screen.getByText(/Validar requerimientos/)).toBeInTheDocument()
  })
})

describe('UpcomingMilestonesCard', () => {
  it('muestra empty cuando no hay hitos', () => {
    render(<UpcomingMilestonesCard items={[]} />)
    expect(screen.getByText(/Sin hitos en la ventana cercana/)).toBeInTheDocument()
  })

  it('etiqueta correctamente "Hoy" / "Mañana" / "En N días"', () => {
    render(
      <UpcomingMilestonesCard
        items={[
          {
            id: 'm1',
            title: 'Kickoff',
            endDate: '2026-05-04T10:00:00Z',
            daysUntil: 0,
            projectId: 'p1',
            projectName: 'SAP',
            status: 'TODO',
          },
          {
            id: 'm2',
            title: 'Demo',
            endDate: '2026-05-05T10:00:00Z',
            daysUntil: 1,
            projectId: 'p1',
            projectName: 'SAP',
            status: 'TODO',
          },
          {
            id: 'm3',
            title: 'Go live',
            endDate: '2026-05-12T10:00:00Z',
            daysUntil: 8,
            projectId: 'p1',
            projectName: 'SAP',
            status: 'TODO',
          },
        ]}
      />,
    )
    expect(screen.getByText('Hoy')).toBeInTheDocument()
    expect(screen.getByText('Mañana')).toBeInTheDocument()
    expect(screen.getByText('En 8 días')).toBeInTheDocument()
  })
})

describe('EVMSnapshotCard', () => {
  it('muestra avg SPI y CPI', () => {
    render(<EVMSnapshotCard report={makePortfolio()} />)
    const card = screen.getByTestId('evm-snapshot-card')
    expect(within(card).getByTestId('evm-metric-spi')).toHaveTextContent('0.90')
    expect(within(card).getByTestId('evm-metric-cpi')).toHaveTextContent('0.82')
    // CV agregado del único row con cv (-20)
    expect(within(card).getByTestId('evm-metric-cv')).toHaveTextContent('-20')
  })

  it('muestra "—" cuando no hay datos EVM', () => {
    const empty: PortfolioReport = {
      generatedAt: new Date().toISOString(),
      rows: [],
      summary: {
        totalProjects: 0,
        healthBreakdown: { green: 0, yellow: 0, red: 0, gray: 0 },
        activeProjects: 0,
        completedProjects: 0,
        avgProgress: 0,
        avgSPI: null,
        avgCPI: null,
      },
    }
    render(<EVMSnapshotCard report={empty} />)
    const spi = screen.getByTestId('evm-metric-spi')
    expect(spi).toHaveTextContent('—')
  })
})
