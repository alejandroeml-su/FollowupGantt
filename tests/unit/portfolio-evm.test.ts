import { describe, it, expect } from 'vitest'
import {
  aggregatePortfolioEvm,
  computeEvmMetrics,
} from '@/lib/portfolio/evm'

describe('portfolio-evm · computeEvmMetrics', () => {
  it('proyecto en presupuesto y a tiempo (CPI=1, SPI=1, EAC=BAC, VAC=0)', () => {
    const m = computeEvmMetrics({ bac: 100, ev: 50, ac: 50, pv: 50 })
    expect(m.cpi).toBe(1)
    expect(m.spi).toBe(1)
    expect(m.eac).toBe(100)
    expect(m.etc).toBe(50)
    expect(m.vac).toBe(0)
  })

  it('proyecto con cost overrun (CPI<1, EAC>BAC, VAC<0)', () => {
    // EV=50, AC=80 → CPI=0.625; BAC=100 → EAC=160; VAC=-60
    const m = computeEvmMetrics({ bac: 100, ev: 50, ac: 80, pv: 50 })
    expect(m.cpi).toBe(0.625)
    expect(m.eac).toBe(160)
    expect(m.vac).toBe(-60)
    expect(m.etc).toBe(80)
  })

  it('proyecto adelantado en cronograma (SPI>1)', () => {
    // EV=60, PV=50 → SPI=1.2
    const m = computeEvmMetrics({ bac: 100, ev: 60, ac: 60, pv: 50 })
    expect(m.spi).toBe(1.2)
  })

  it('AC=0 → CPI null (no hay base para calcular)', () => {
    const m = computeEvmMetrics({ bac: 100, ev: 30, ac: 0, pv: 30 })
    expect(m.cpi).toBeNull()
    expect(m.eac).toBeNull()
    expect(m.etc).toBeNull()
    expect(m.vac).toBeNull()
  })

  it('PV=0 → SPI null', () => {
    const m = computeEvmMetrics({ bac: 100, ev: 30, ac: 30, pv: 0 })
    expect(m.spi).toBeNull()
    // CPI sí computable con AC>0
    expect(m.cpi).toBe(1)
  })

  it('todos null → todos null', () => {
    const m = computeEvmMetrics({ bac: null, ev: null, ac: null, pv: null })
    expect(m.cpi).toBeNull()
    expect(m.spi).toBeNull()
    expect(m.eac).toBeNull()
  })

  it('bac null pero CPI computable → EAC null igual', () => {
    const m = computeEvmMetrics({ bac: null, ev: 50, ac: 50, pv: 50 })
    expect(m.cpi).toBe(1)
    expect(m.eac).toBeNull()
  })
})

describe('portfolio-evm · aggregatePortfolioEvm', () => {
  it('agrega 2 proyectos con CPI=1', () => {
    const total = aggregatePortfolioEvm([
      { bac: 100, ev: 50, ac: 50, pv: 50 },
      { bac: 200, ev: 100, ac: 100, pv: 100 },
    ])
    expect(total.bac).toBe(300)
    expect(total.ev).toBe(150)
    expect(total.ac).toBe(150)
    expect(total.cpi).toBe(1)
    expect(total.eac).toBe(300)
  })

  it('un proyecto con overrun arrastra el CPI agregado', () => {
    const total = aggregatePortfolioEvm([
      { bac: 100, ev: 50, ac: 50, pv: 50 }, // sano
      { bac: 100, ev: 50, ac: 100, pv: 50 }, // overrun
    ])
    // Suma: BAC=200, EV=100, AC=150 → CPI = 100/150 = 0.6667
    expect(total.cpi).toBe(0.6667)
    // EAC = 200/0.6667 ≈ 299.99 (drift por redondeo de CPI a 4 decimales)
    expect(total.eac).toBeCloseTo(300, 0)
  })

  it('proyectos sin EVM (todos null) → todo 0 → cpi null', () => {
    const total = aggregatePortfolioEvm([
      { bac: null, ev: null, ac: null, pv: null },
      { bac: null, ev: null, ac: null, pv: null },
    ])
    expect(total.cpi).toBeNull()
  })

  it('lista vacía → ceros y cpi null', () => {
    const total = aggregatePortfolioEvm([])
    expect(total.bac).toBe(0)
    expect(total.ev).toBe(0)
    expect(total.cpi).toBeNull()
  })
})
