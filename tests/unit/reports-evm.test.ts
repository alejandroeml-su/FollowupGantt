import { describe, it, expect } from 'vitest'
import {
  classifyHealth,
  computeEVM,
  formatIndex,
  formatMoney,
  plannedFraction,
} from '@/lib/reports/evm'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('reports/evm · plannedFraction', () => {
  it('devuelve 0 sin fechas', () => {
    expect(plannedFraction(null, null, utc('2026-05-01'))).toBe(0)
  })

  it('devuelve 1 cuando endDate es pasada y no hay startDate', () => {
    expect(plannedFraction(null, utc('2026-04-01'), utc('2026-05-01'))).toBe(1)
  })

  it('devuelve 0 cuando endDate es futura y no hay startDate', () => {
    expect(plannedFraction(null, utc('2026-06-01'), utc('2026-05-01'))).toBe(0)
  })

  it('prorratea linealmente entre start y end', () => {
    // 10 días totales, han transcurrido 5 → 0.5
    const f = plannedFraction(
      utc('2026-05-01'),
      utc('2026-05-11'),
      utc('2026-05-06'),
    )
    expect(f).toBeCloseTo(0.5, 2)
  })

  it('clipea a 0 antes del start y a 1 después del end', () => {
    expect(
      plannedFraction(utc('2026-05-10'), utc('2026-05-20'), utc('2026-05-01')),
    ).toBe(0)
    expect(
      plannedFraction(utc('2026-05-10'), utc('2026-05-20'), utc('2026-06-01')),
    ).toBe(1)
  })
})

describe('reports/evm · computeEVM', () => {
  it('lanza INSUFFICIENT_DATA cuando ninguna tarea tiene presupuesto', () => {
    expect(() =>
      computeEVM(
        [
          {
            id: 't1',
            plannedValue: 0,
            actualCost: 0,
            earnedValue: 0,
            progress: 50,
            startDate: utc('2026-05-01'),
            endDate: utc('2026-05-10'),
          },
        ],
        utc('2026-05-05'),
      ),
    ).toThrow(/INSUFFICIENT_DATA/)
  })

  it('lanza INVALID_INPUT con progreso fuera de rango', () => {
    expect(() =>
      computeEVM(
        [
          {
            id: 't1',
            plannedValue: 1000,
            actualCost: 500,
            earnedValue: null,
            progress: 150,
            startDate: utc('2026-05-01'),
            endDate: utc('2026-05-10'),
          },
        ],
        utc('2026-05-05'),
      ),
    ).toThrow(/INVALID_INPUT/)
  })

  it('lanza INVALID_INPUT con plannedValue negativo', () => {
    expect(() =>
      computeEVM(
        [
          {
            id: 't1',
            plannedValue: -100,
            actualCost: null,
            earnedValue: null,
            progress: 0,
            startDate: utc('2026-05-01'),
            endDate: utc('2026-05-10'),
          },
        ],
      ),
    ).toThrow(/INVALID_INPUT/)
  })

  it('calcula PV/EV/AC para una tarea con progress 0 y endDate pasada', () => {
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 1000,
          actualCost: 200,
          earnedValue: null,
          progress: 0,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-05'),
        },
      ],
      utc('2026-05-10'),
    )
    expect(r.pv).toBe(1000) // endDate pasada → fracción 1
    expect(r.ev).toBe(0) // progress 0
    expect(r.ac).toBe(200)
    expect(r.sv).toBe(-1000)
    expect(r.cv).toBe(-200)
    expect(r.spi).toBe(0)
    expect(r.cpi).toBe(0)
  })

  it('calcula PV/EV/AC para una tarea con progress 100', () => {
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 1000,
          actualCost: 800,
          earnedValue: null,
          progress: 100,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-05'),
        },
      ],
      utc('2026-05-10'),
    )
    expect(r.pv).toBe(1000)
    expect(r.ev).toBe(1000)
    expect(r.ac).toBe(800)
    expect(r.spi).toBe(1)
    expect(r.cpi).toBe(1.25)
    expect(r.acIsEstimated).toBe(false)
  })

  it('marca acIsEstimated=true si ninguna tarea tiene actualCost', () => {
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 1000,
          actualCost: null,
          earnedValue: null,
          progress: 50,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-10'),
        },
      ],
      utc('2026-05-10'),
    )
    expect(r.acIsEstimated).toBe(true)
    // Cuando no hay AC, se usa EV como proxy → CPI = 1.
    expect(r.cpi).toBe(1)
    expect(r.ac).toBe(r.ev)
  })

  it('respeta earnedValue precalculado si está disponible', () => {
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 1000,
          actualCost: 500,
          earnedValue: 750, // override
          progress: 50, // sería 500 sin override
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-05'),
        },
      ],
      utc('2026-05-10'),
    )
    expect(r.ev).toBe(750)
  })

  it('agrega múltiples tareas con fecha futura prorrateada', () => {
    const asOf = utc('2026-05-06')
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 1000,
          actualCost: 400,
          earnedValue: null,
          progress: 100,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-05'),
        },
        {
          id: 't2',
          plannedValue: 2000,
          actualCost: null,
          earnedValue: null,
          progress: 0,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-11'),
        },
      ],
      asOf,
    )
    // PV = 1000 (t1 completa) + 2000 * 0.5 (t2 al 50% del calendario) = 2000
    expect(r.pv).toBeCloseTo(2000, 1)
    expect(r.ev).toBe(1000) // t1 100% → 1000, t2 0% → 0
    expect(r.bac).toBe(3000)
    expect(r.budgetedTaskCount).toBe(2)
    expect(r.taskCount).toBe(2)
  })

  it('calcula EAC y VAC cuando hay CPI > 0', () => {
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 2000,
          actualCost: 400,
          earnedValue: null,
          progress: 100,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-05'),
        },
      ],
      utc('2026-05-10'),
    )
    // CPI = 2000/400 = 5; EAC = 2000/5 = 400; VAC = 2000-400 = 1600
    expect(r.cpi).toBe(5)
    expect(r.eac).toBe(400)
    expect(r.vac).toBe(1600)
  })

  it('lanza INVALID_INPUT con asOf inválido', () => {
    expect(() =>
      computeEVM(
        [
          {
            id: 't1',
            plannedValue: 100,
            actualCost: 0,
            earnedValue: null,
            progress: 0,
            startDate: utc('2026-05-01'),
            endDate: utc('2026-05-05'),
          },
        ],
        new Date('not a date'),
      ),
    ).toThrow(/INVALID_INPUT/)
  })

  it('emite perTask con los mismos totales agregados', () => {
    const r = computeEVM(
      [
        {
          id: 't1',
          plannedValue: 1000,
          actualCost: 500,
          earnedValue: null,
          progress: 50,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-05'),
        },
        {
          id: 't2',
          plannedValue: 500,
          actualCost: 200,
          earnedValue: null,
          progress: 100,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-03'),
        },
      ],
      utc('2026-05-10'),
    )
    const sumEV = r.perTask.reduce((acc, t) => acc + t.ev, 0)
    const sumAC = r.perTask.reduce((acc, t) => acc + t.ac, 0)
    expect(sumEV).toBeCloseTo(r.ev, 1)
    expect(sumAC).toBeCloseTo(r.ac, 1)
  })
})

describe('reports/evm · classifyHealth', () => {
  it('verde cuando todo OK', () => {
    expect(classifyHealth({ cv: 100, spi: 1.05, cpi: 1.1 })).toBe('green')
  })

  it('rojo cuando CV<0', () => {
    expect(classifyHealth({ cv: -50, spi: 1, cpi: 1 })).toBe('red')
  })

  it('rojo cuando SPI<0.9', () => {
    expect(classifyHealth({ cv: 10, spi: 0.85, cpi: 1.0 })).toBe('red')
  })

  it('amarillo cuando CPI<1 pero CV>=0', () => {
    expect(classifyHealth({ cv: 0, spi: 1, cpi: 0.95 })).toBe('yellow')
  })

  it('amarillo cuando SPI<1 (entre 0.9 y 1) y CV>=0', () => {
    expect(classifyHealth({ cv: 0, spi: 0.95, cpi: 1.0 })).toBe('yellow')
  })

  it('gris cuando no hay índices', () => {
    expect(classifyHealth({ cv: 0, spi: null, cpi: null })).toBe('gray')
  })
})

describe('reports/evm · formatters', () => {
  it('formatIndex: dos decimales o em-dash', () => {
    expect(formatIndex(1.234)).toBe('1.23')
    expect(formatIndex(null)).toBe('—')
    expect(formatIndex(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('formatMoney: maneja millones, miles y negativos', () => {
    expect(formatMoney(2_500_000)).toBe('$2.50M')
    expect(formatMoney(45_000)).toBe('$45.0K')
    expect(formatMoney(-1500)).toBe('-$1.5K')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(750)).toBe('$750')
  })
})
