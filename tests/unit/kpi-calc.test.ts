import { describe, it, expect } from 'vitest'
import {
  classifyIndex,
  classifyPlannedVsActual,
  classifyROI,
  classifyScopeCreep,
  classifySuccessRate,
  classifyUtilization,
  classifyVariance,
  computeEVMTotals,
  formatCurrency,
  lastNMonths,
  monthKey,
} from '@/lib/kpi-calc'

describe('kpi-calc · formatCurrency', () => {
  it('formatea millones con sufijo M', () => {
    expect(formatCurrency(2_500_000)).toBe('$2.5M')
  })

  it('formatea miles con sufijo K', () => {
    expect(formatCurrency(45_000)).toBe('$45.0K')
  })

  it('formatea negativos con signo', () => {
    expect(formatCurrency(-1_500)).toBe('-$1.5K')
  })

  it('entrega guion largo cuando no hay dato', () => {
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('formatea valores pequeños sin sufijo', () => {
    expect(formatCurrency(500)).toBe('$500')
  })
})

describe('kpi-calc · monthKey / lastNMonths', () => {
  it('monthKey produce formato YYYY-MM con padding', () => {
    expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01')
    expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12')
  })

  it('lastNMonths retorna N meses ordenados ascendentes', () => {
    const ref = new Date(2026, 5, 15) // junio 2026
    expect(lastNMonths(3, ref)).toEqual(['2026-04', '2026-05', '2026-06'])
  })

  it('lastNMonths cruza años correctamente', () => {
    const ref = new Date(2026, 1, 10) // febrero 2026
    expect(lastNMonths(4, ref)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})

describe('kpi-calc · classifyIndex (SPI/CPI)', () => {
  it('neutral cuando no hay dato', () => {
    expect(classifyIndex(null, 'spi').tone).toBe('neutral')
    expect(classifyIndex(null, 'cpi').tone).toBe('neutral')
    expect(classifyIndex(Number.NaN, 'spi').tone).toBe('neutral')
  })

  it('success cuando index >= 1', () => {
    expect(classifyIndex(1.15, 'spi').tone).toBe('success')
    expect(classifyIndex(1.0, 'cpi').tone).toBe('success')
    expect(classifyIndex(1.15, 'spi').label).toBe('Adelantado')
    expect(classifyIndex(1.15, 'cpi').label).toBe('Eficiente')
  })

  it('warning en zona 0.9 <= index < 1', () => {
    expect(classifyIndex(0.95, 'spi').tone).toBe('warning')
    expect(classifyIndex(0.9, 'cpi').tone).toBe('warning')
  })

  it('danger cuando index < 0.9', () => {
    expect(classifyIndex(0.7, 'spi').tone).toBe('danger')
    expect(classifyIndex(0.7, 'spi').label).toBe('Retrasado')
    expect(classifyIndex(0.7, 'cpi').label).toBe('Sobre costo')
  })
})

describe('kpi-calc · classifyVariance (SV/CV)', () => {
  it('success cuando varianza >= 0', () => {
    expect(classifyVariance(500, 10_000, 'schedule').tone).toBe('success')
    expect(classifyVariance(0, 10_000, 'cost').tone).toBe('success')
  })

  it('warning en rango [-10%, 0)', () => {
    expect(classifyVariance(-500, 10_000, 'schedule').tone).toBe('warning')
    expect(classifyVariance(-1_000, 10_000, 'cost').tone).toBe('warning')
  })

  it('danger cuando varianza < -10% del PV', () => {
    expect(classifyVariance(-2_000, 10_000, 'schedule').tone).toBe('danger')
    expect(classifyVariance(-2_000, 10_000, 'schedule').label).toBe('Retraso crítico')
    expect(classifyVariance(-2_000, 10_000, 'cost').label).toBe('Sobregiro crítico')
  })

  it('si PV = 0 y varianza negativa → danger', () => {
    expect(classifyVariance(-100, 0, 'cost').tone).toBe('danger')
  })
})

describe('kpi-calc · classifyROI', () => {
  it('neutral cuando null', () => {
    expect(classifyROI(null).tone).toBe('neutral')
  })

  it('success para ROI >= 15%', () => {
    expect(classifyROI(20).tone).toBe('success')
    expect(classifyROI(20).label).toBe('Alto retorno')
  })

  it('success para ROI entre 0 y 15', () => {
    expect(classifyROI(5).tone).toBe('success')
    expect(classifyROI(5).label).toBe('Positivo')
  })

  it('warning para ROI entre -10 y 0', () => {
    expect(classifyROI(-5).tone).toBe('warning')
  })

  it('danger para ROI < -10', () => {
    expect(classifyROI(-25).tone).toBe('danger')
  })
})

describe('kpi-calc · classifySuccessRate', () => {
  it('success >= 80', () => {
    expect(classifySuccessRate(85).tone).toBe('success')
  })

  it('warning [60, 80)', () => {
    expect(classifySuccessRate(70).tone).toBe('warning')
  })

  it('danger < 60', () => {
    expect(classifySuccessRate(45).tone).toBe('danger')
  })

  it('neutral cuando null', () => {
    expect(classifySuccessRate(null).tone).toBe('neutral')
  })
})

describe('kpi-calc · classifyUtilization', () => {
  it('success en rango saludable 70-90', () => {
    expect(classifyUtilization(80).tone).toBe('success')
    expect(classifyUtilization(70).tone).toBe('success')
    expect(classifyUtilization(90).tone).toBe('success')
  })

  it('danger por sobrecarga >90', () => {
    expect(classifyUtilization(95).tone).toBe('danger')
    expect(classifyUtilization(95).label).toBe('Sobrecargado')
  })

  it('warning por subutilización [50, 70)', () => {
    expect(classifyUtilization(60).tone).toBe('warning')
  })

  it('danger crítico <50', () => {
    expect(classifyUtilization(30).tone).toBe('danger')
  })

  it('neutral cuando null', () => {
    expect(classifyUtilization(null).tone).toBe('neutral')
  })
})

describe('kpi-calc · classifyScopeCreep', () => {
  it('controlado <= 5%', () => {
    expect(classifyScopeCreep(4).tone).toBe('success')
  })

  it('atención (5, 15]', () => {
    expect(classifyScopeCreep(10).tone).toBe('warning')
  })

  it('alto riesgo > 15%', () => {
    expect(classifyScopeCreep(25).tone).toBe('danger')
  })
})

describe('kpi-calc · classifyPlannedVsActual', () => {
  it('en plan >= 95%', () => {
    expect(classifyPlannedVsActual(100).tone).toBe('success')
  })

  it('en riesgo [75, 95)', () => {
    expect(classifyPlannedVsActual(80).tone).toBe('warning')
  })

  it('desviado < 75', () => {
    expect(classifyPlannedVsActual(50).tone).toBe('danger')
  })
})

describe('kpi-calc · computeEVMTotals', () => {
  it('suma PV y AC directamente', () => {
    const result = computeEVMTotals([
      { plannedValue: 1000, actualCost: 800, earnedValue: null, progress: 100 },
      { plannedValue: 2000, actualCost: 1500, earnedValue: null, progress: 50 },
    ])
    expect(result.pv).toBe(3000)
    expect(result.ac).toBe(2300)
  })

  it('calcula EV = PV * progress/100 cuando no hay earnedValue explícito', () => {
    const result = computeEVMTotals([
      { plannedValue: 1000, actualCost: 0, earnedValue: null, progress: 100 },
      { plannedValue: 2000, actualCost: 0, earnedValue: null, progress: 50 },
    ])
    expect(result.ev).toBe(2000) // 1000 + 1000
  })

  it('respeta earnedValue explícito si está presente', () => {
    const result = computeEVMTotals([
      { plannedValue: 1000, actualCost: 0, earnedValue: 750, progress: 100 },
    ])
    expect(result.ev).toBe(750)
  })

  it('trata null/undefined como 0 en PV y AC', () => {
    const result = computeEVMTotals([
      { plannedValue: null, actualCost: null, earnedValue: null, progress: 0 },
    ])
    expect(result.pv).toBe(0)
    expect(result.ac).toBe(0)
    expect(result.ev).toBe(0)
  })

  it('array vacío retorna ceros', () => {
    expect(computeEVMTotals([])).toEqual({ pv: 0, ev: 0, ac: 0 })
  })
})
