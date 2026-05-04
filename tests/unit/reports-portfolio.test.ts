import { describe, it, expect } from 'vitest'
import {
  buildPortfolioReport,
  healthLabel,
  type PortfolioProjectInput,
} from '@/lib/reports/portfolio'
import type { EVMResult } from '@/lib/reports/evm'

const evmStub = (over: Partial<EVMResult>): EVMResult => ({
  pv: 1000,
  ev: 1000,
  ac: 1000,
  sv: 0,
  cv: 0,
  spi: 1,
  cpi: 1,
  bac: 1000,
  eac: 1000,
  vac: 0,
  asOf: '2026-05-01T00:00:00.000Z',
  taskCount: 1,
  budgetedTaskCount: 1,
  acIsEstimated: false,
  perTask: [],
  ...over,
})

const projectStub = (
  over: Partial<PortfolioProjectInput>,
): PortfolioProjectInput => ({
  id: 'p',
  name: 'Proyecto',
  status: 'ACTIVE',
  evm: evmStub({}),
  progressPercent: 50,
  totalTasks: 10,
  completedTasks: 5,
  nextMilestone: null,
  ...over,
})

describe('reports/portfolio · healthLabel', () => {
  it('mapea cada estado a la etiqueta ES correspondiente', () => {
    expect(healthLabel('green')).toBe('Saludable')
    expect(healthLabel('yellow')).toBe('En margen')
    expect(healthLabel('red')).toBe('Crítico')
    expect(healthLabel('gray')).toBe('Sin datos')
  })
})

describe('reports/portfolio · buildPortfolioReport', () => {
  it('marca proyectos sin EVM como gray', () => {
    const r = buildPortfolioReport([
      projectStub({ id: 'a', evm: null, progressPercent: 30 }),
    ])
    expect(r.rows[0]?.health).toBe('gray')
    expect(r.summary.healthBreakdown.gray).toBe(1)
    expect(r.summary.totalProjects).toBe(1)
  })

  it('clasifica salud por proyecto y agrega contadores', () => {
    const r = buildPortfolioReport([
      projectStub({
        id: 'green',
        evm: evmStub({ cv: 100, spi: 1.05, cpi: 1.1 }),
      }),
      projectStub({
        id: 'red',
        evm: evmStub({ cv: -50, spi: 0.85, cpi: 0.9 }),
      }),
      projectStub({
        id: 'yellow',
        evm: evmStub({ cv: 0, spi: 0.95, cpi: 0.98 }),
      }),
    ])
    const byId = Object.fromEntries(r.rows.map((row) => [row.id, row.health]))
    expect(byId.green).toBe('green')
    expect(byId.red).toBe('red')
    expect(byId.yellow).toBe('yellow')
    expect(r.summary.healthBreakdown.green).toBe(1)
    expect(r.summary.healthBreakdown.red).toBe(1)
    expect(r.summary.healthBreakdown.yellow).toBe(1)
  })

  it('promedia avance / SPI / CPI sólo donde hay datos', () => {
    const r = buildPortfolioReport([
      projectStub({
        id: 'a',
        progressPercent: 100,
        evm: evmStub({ spi: 1.0, cpi: 1.0 }),
      }),
      projectStub({
        id: 'b',
        progressPercent: 50,
        evm: evmStub({ spi: 0.5, cpi: 0.5 }),
      }),
      projectStub({ id: 'c', progressPercent: 0, evm: null }),
    ])
    expect(r.summary.avgProgress).toBe(50)
    // Promedios sólo sobre los que tienen EVM (a y b)
    expect(r.summary.avgSPI).toBeCloseTo(0.75, 4)
    expect(r.summary.avgCPI).toBeCloseTo(0.75, 4)
  })

  it('cuenta proyectos activos y completados por status', () => {
    const r = buildPortfolioReport([
      projectStub({ id: '1', status: 'ACTIVE' }),
      projectStub({ id: '2', status: 'ACTIVE' }),
      projectStub({ id: '3', status: 'COMPLETED' }),
      projectStub({ id: '4', status: 'PLANNING' }),
    ])
    expect(r.summary.activeProjects).toBe(2)
    expect(r.summary.completedProjects).toBe(1)
  })

  it('devuelve avgSPI null si ningún proyecto reporta SPI', () => {
    const r = buildPortfolioReport([
      projectStub({ id: 'a', evm: null }),
      projectStub({ id: 'b', evm: null }),
    ])
    expect(r.summary.avgSPI).toBeNull()
    expect(r.summary.avgCPI).toBeNull()
  })

  it('preserva nextMilestone en la fila', () => {
    const r = buildPortfolioReport([
      projectStub({
        id: 'a',
        nextMilestone: {
          id: 'm1',
          title: 'Demo',
          endDate: '2026-05-15T00:00:00.000Z',
          daysUntil: 14,
        },
      }),
    ])
    expect(r.rows[0]?.nextMilestone?.title).toBe('Demo')
  })
})
