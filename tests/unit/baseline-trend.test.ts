import { describe, it, expect } from 'vitest'

/**
 * HU-3.4 · Tests del helper de trend mensual SV/SPI.
 *
 * Cubre los escenarios mínimos del spec:
 *  - Trend con 1 mes
 *  - Trend con 6 meses (data sintética)
 *  - Mes sin tareas planificadas (PV=0 → SPI null)
 *  - SPI=1.0 cuando todo cierra en plan
 *  - SPI<1 cuando hay atraso
 *  - SPI>1 cuando hay adelanto
 *  - takeLastN y formatMonthLabel
 */

import {
  computeBaselineTrend,
  formatMonthLabel,
  takeLastN,
  type TaskForTrend,
} from '@/lib/scheduling/baseline-trend'
import type {
  BaselineSnapshot,
  BaselineTask,
} from '@/lib/scheduling/baseline-snapshot'

function bsTask(partial: Partial<BaselineTask> = {}): BaselineTask {
  return {
    id: 't1',
    mnemonic: 'PROJ-1',
    title: 'Diseño',
    plannedStart: '2026-05-01T00:00:00.000Z',
    plannedEnd: '2026-05-31T00:00:00.000Z',
    plannedValue: 1000,
    earnedValue: 0,
    actualCost: 0,
    progress: 0,
    status: 'TODO',
    ...partial,
  }
}

function snapshot(tasks: BaselineTask[]): BaselineSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: '2026-04-15T00:00:00.000Z',
    label: null,
    tasks,
  }
}

function realTask(partial: Partial<TaskForTrend> = {}): TaskForTrend {
  return {
    id: 't1',
    startDate: '2026-05-01T00:00:00.000Z',
    endDate: '2026-05-31T00:00:00.000Z',
    plannedValue: 1000,
    earnedValue: 1000,
    progress: 100,
    ...partial,
  }
}

describe('baseline-trend · computeBaselineTrend (1 mes)', () => {
  it('retorna 1 punto cuando todo cabe en un solo mes', () => {
    const out = computeBaselineTrend(
      snapshot([bsTask()]),
      [realTask()],
    )
    expect(out).toHaveLength(1)
    expect(out[0].monthKey).toBe('2026-05')
    expect(out[0].pv).toBe(1000)
    expect(out[0].ev).toBe(1000)
    expect(out[0].sv).toBe(0)
    expect(out[0].spi).toBe(1)
  })

  it('SPI = 1.0 exactamente cuando todo está en plan', () => {
    const out = computeBaselineTrend(
      snapshot([bsTask({ plannedValue: 5000 })]),
      [realTask({ earnedValue: 5000 })],
    )
    expect(out[0].spi).toBe(1)
  })
})

describe('baseline-trend · computeBaselineTrend (6 meses sintéticos)', () => {
  // 6 tareas, una por mes ene→jun 2026, cada una 1000 PV. Real avanza
  // perfecto las 3 primeras, las siguientes con desviaciones.
  const baseline = snapshot([
    bsTask({
      id: 't-ene',
      plannedStart: '2026-01-01T00:00:00.000Z',
      plannedEnd: '2026-01-31T00:00:00.000Z',
    }),
    bsTask({
      id: 't-feb',
      plannedStart: '2026-02-01T00:00:00.000Z',
      plannedEnd: '2026-02-28T00:00:00.000Z',
    }),
    bsTask({
      id: 't-mar',
      plannedStart: '2026-03-01T00:00:00.000Z',
      plannedEnd: '2026-03-31T00:00:00.000Z',
    }),
    bsTask({
      id: 't-abr',
      plannedStart: '2026-04-01T00:00:00.000Z',
      plannedEnd: '2026-04-30T00:00:00.000Z',
    }),
    bsTask({
      id: 't-may',
      plannedStart: '2026-05-01T00:00:00.000Z',
      plannedEnd: '2026-05-31T00:00:00.000Z',
    }),
    bsTask({
      id: 't-jun',
      plannedStart: '2026-06-01T00:00:00.000Z',
      plannedEnd: '2026-06-30T00:00:00.000Z',
    }),
  ])

  it('genera 6 puntos en orden ascendente', () => {
    const out = computeBaselineTrend(baseline, [
      realTask({
        id: 't-ene',
        endDate: '2026-01-31T00:00:00.000Z',
        earnedValue: 1000,
      }),
    ])
    expect(out).toHaveLength(6)
    expect(out.map((p) => p.monthKey)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ])
  })

  it('PV es acumulado (cada mes incluye todas las planeadas hasta esa fecha)', () => {
    const out = computeBaselineTrend(baseline, [])
    // Enero: solo t-ene plan → 1000
    expect(out[0].pv).toBe(1000)
    // Junio: las 6 → 6000
    expect(out[5].pv).toBe(6000)
  })
})

describe('baseline-trend · SPI < 1 (atraso)', () => {
  it('SPI cae por debajo de 1 cuando EV < PV', () => {
    const baseline = snapshot([
      bsTask({
        id: 'a',
        plannedStart: '2026-01-01T00:00:00.000Z',
        plannedEnd: '2026-01-31T00:00:00.000Z',
        plannedValue: 1000,
      }),
      bsTask({
        id: 'b',
        plannedStart: '2026-02-01T00:00:00.000Z',
        plannedEnd: '2026-02-28T00:00:00.000Z',
        plannedValue: 1000,
      }),
    ])
    // Solo la tarea A se completó al cierre de enero; B se atrasó a
    // marzo y por tanto en febrero el EV solo cuenta A.
    const out = computeBaselineTrend(baseline, [
      realTask({
        id: 'a',
        endDate: '2026-01-31T00:00:00.000Z',
        earnedValue: 1000,
      }),
      realTask({
        id: 'b',
        endDate: '2026-03-15T00:00:00.000Z',
        earnedValue: 1000,
      }),
    ])
    // Febrero: PV = 2000 (A+B planificadas), EV = 1000 (solo A llegó).
    const feb = out.find((p) => p.monthKey === '2026-02')!
    expect(feb.pv).toBe(2000)
    expect(feb.ev).toBe(1000)
    expect(feb.sv).toBe(-1000)
    expect(feb.spi).toBeLessThan(1)
    expect(feb.spi).toBeCloseTo(0.5, 5)
  })
})

describe('baseline-trend · SPI > 1 (adelanto)', () => {
  it('SPI > 1 cuando EV supera al PV planificado', () => {
    const baseline = snapshot([
      bsTask({
        id: 'a',
        plannedStart: '2026-01-01T00:00:00.000Z',
        plannedEnd: '2026-02-28T00:00:00.000Z',
        plannedValue: 1000,
      }),
    ])
    // La tarea termina en enero (1 mes antes de su plannedEnd de feb).
    const out = computeBaselineTrend(baseline, [
      realTask({
        id: 'a',
        endDate: '2026-01-31T00:00:00.000Z',
        earnedValue: 1000,
      }),
    ])
    // Enero: PV = 0 (la baseline planeó cerrar en feb), EV = 1000.
    const ene = out.find((p) => p.monthKey === '2026-01')!
    expect(ene.pv).toBe(0)
    expect(ene.ev).toBe(1000)
    // Si PV = 0 retornamos null (criterio del helper).
    expect(ene.spi).toBeNull()
    // Febrero: PV alcanza, EV ya está → SPI = 1
    const feb = out.find((p) => p.monthKey === '2026-02')!
    expect(feb.pv).toBe(1000)
    expect(feb.ev).toBe(1000)
    expect(feb.spi).toBe(1)
  })

  it('SPI > 1 numérico cuando se entrega más temprano y aún hay PV', () => {
    const baseline = snapshot([
      bsTask({
        id: 'a',
        plannedStart: '2026-01-01T00:00:00.000Z',
        plannedEnd: '2026-01-31T00:00:00.000Z',
        plannedValue: 1000,
      }),
      bsTask({
        id: 'b',
        plannedStart: '2026-02-01T00:00:00.000Z',
        plannedEnd: '2026-02-28T00:00:00.000Z',
        plannedValue: 1000,
      }),
    ])
    // Ambas tareas se completan en enero — anticipa B.
    const out = computeBaselineTrend(baseline, [
      realTask({
        id: 'a',
        endDate: '2026-01-31T00:00:00.000Z',
        earnedValue: 1000,
      }),
      realTask({
        id: 'b',
        endDate: '2026-01-30T00:00:00.000Z',
        earnedValue: 1000,
      }),
    ])
    const ene = out.find((p) => p.monthKey === '2026-01')!
    // PV(ene) = 1000 (solo A planificada al cierre), EV(ene) = 2000 (A+B reales).
    expect(ene.pv).toBe(1000)
    expect(ene.ev).toBe(2000)
    expect(ene.spi).toBe(2)
  })
})

describe('baseline-trend · mes sin tareas planificadas', () => {
  it('PV=0 y SPI null cuando ninguna tarea cierra ese mes', () => {
    const baseline = snapshot([
      bsTask({
        id: 'a',
        plannedStart: '2026-03-01T00:00:00.000Z',
        plannedEnd: '2026-03-31T00:00:00.000Z',
        plannedValue: 1000,
      }),
    ])
    const out = computeBaselineTrend(baseline, [])
    // Solo 1 mes (marzo) — el helper acota al rango de tareas.
    expect(out).toHaveLength(1)
    expect(out[0].monthKey).toBe('2026-03')
    expect(out[0].pv).toBe(1000)
    expect(out[0].ev).toBe(0)
    expect(out[0].spi).toBeCloseTo(0, 5)
  })

  it('snapshot vacío + tasks vacías → []', () => {
    const out = computeBaselineTrend(snapshot([]), [])
    expect(out).toEqual([])
  })
})

describe('baseline-trend · helpers utilitarios', () => {
  it('takeLastN devuelve los últimos N', () => {
    expect(takeLastN([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5])
    expect(takeLastN([1, 2], 5)).toEqual([1, 2])
    expect(takeLastN([], 5)).toEqual([])
    expect(takeLastN([1, 2, 3], 0)).toEqual([])
  })

  it('formatMonthLabel produce string no vacío', () => {
    const label = formatMonthLabel(new Date(Date.UTC(2026, 4, 1)))
    expect(label).toBeTruthy()
    expect(label).toContain('2026')
  })
})
