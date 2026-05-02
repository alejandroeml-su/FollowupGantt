import { describe, it, expect } from 'vitest'

/**
 * HU-3.3 · Tests del helper de varianza baseline ↔ real.
 *
 * Cubre los 6 casos del árbol de decisión:
 *  - on-plan (delta = 0)
 *  - minor (1–5d)
 *  - moderate (6–15d)
 *  - critical (>15d)
 *  - missing (tarea creada después de la baseline)
 *  - no-data (sin fechas en la baseline o en la tarea real)
 *
 * También aserta el formato del `aria-label` y el mapa por id.
 */

import {
  buildVarianceMap,
  classifyDelta,
  computeTaskVariance,
  describeBaselineBar,
  type TaskForVariance,
} from '@/lib/scheduling/baseline-variance'
import type { BaselineTask } from '@/lib/scheduling/baseline-snapshot'

function snapshotEntry(partial: Partial<BaselineTask> = {}): BaselineTask {
  return {
    id: 't1',
    mnemonic: 'PROJ-1',
    title: 'Diseño',
    plannedStart: '2026-05-02T00:00:00.000Z',
    plannedEnd: '2026-05-05T00:00:00.000Z',
    plannedValue: 1000,
    earnedValue: 0,
    actualCost: 0,
    progress: 0,
    status: 'TODO',
    ...partial,
  }
}

function realTask(partial: Partial<TaskForVariance> = {}): TaskForVariance {
  return {
    id: 't1',
    startDate: '2026-05-02T00:00:00.000Z',
    endDate: '2026-05-05T00:00:00.000Z',
    ...partial,
  }
}

describe('baseline-variance · classifyDelta', () => {
  it('on-plan cuando delta ≤ 0 (incluido adelanto)', () => {
    expect(classifyDelta(0)).toBe('on-plan')
    expect(classifyDelta(-3)).toBe('on-plan')
    expect(classifyDelta(-30)).toBe('on-plan')
  })

  it('minor entre 1 y 5 días de retraso', () => {
    expect(classifyDelta(1)).toBe('minor')
    expect(classifyDelta(5)).toBe('minor')
  })

  it('moderate entre 6 y 15 días', () => {
    expect(classifyDelta(6)).toBe('moderate')
    expect(classifyDelta(15)).toBe('moderate')
  })

  it('critical cuando supera 15 días', () => {
    expect(classifyDelta(16)).toBe('critical')
    expect(classifyDelta(60)).toBe('critical')
  })
})

describe('baseline-variance · computeTaskVariance', () => {
  it('cero delta → on-plan y plannedDuration calculada', () => {
    const v = computeTaskVariance(realTask(), snapshotEntry())
    expect(v.deltaDays).toBe(0)
    expect(v.classification).toBe('on-plan')
    // Inclusive: del 2 al 5 son 4 días.
    expect(v.plannedDurationDays).toBe(4)
    expect(v.plannedStart).toBe('2026-05-02T00:00:00.000Z')
  })

  it('retraso leve (3 días) → minor', () => {
    const v = computeTaskVariance(
      realTask({ endDate: '2026-05-08T00:00:00.000Z' }),
      snapshotEntry(),
    )
    expect(v.deltaDays).toBe(3)
    expect(v.classification).toBe('minor')
  })

  it('retraso moderado (10 días) → moderate', () => {
    const v = computeTaskVariance(
      realTask({ endDate: '2026-05-15T00:00:00.000Z' }),
      snapshotEntry(),
    )
    expect(v.deltaDays).toBe(10)
    expect(v.classification).toBe('moderate')
  })

  it('retraso crítico (>15 días) → critical', () => {
    const v = computeTaskVariance(
      realTask({ endDate: '2026-06-01T00:00:00.000Z' }),
      snapshotEntry(),
    )
    expect(v.deltaDays).toBe(27)
    expect(v.classification).toBe('critical')
  })

  it('adelanto puro (-5 días) → on-plan, sin decoración', () => {
    const v = computeTaskVariance(
      realTask({ endDate: '2026-04-30T00:00:00.000Z' }),
      snapshotEntry(),
    )
    expect(v.deltaDays).toBe(-5)
    expect(v.classification).toBe('on-plan')
  })

  it('tarea nueva (no estaba en el snapshot) → missing, sin barra fantasma', () => {
    const v = computeTaskVariance(realTask({ id: 'new-task' }), null)
    expect(v.deltaDays).toBeNull()
    expect(v.classification).toBe('missing')
    expect(v.plannedStart).toBeNull()
    expect(v.plannedEnd).toBeNull()
    expect(v.plannedDurationDays).toBeNull()
  })

  it('tarea sin fecha real (endDate null) → no-data pero conserva planned*', () => {
    const v = computeTaskVariance(
      realTask({ endDate: null }),
      snapshotEntry(),
    )
    expect(v.deltaDays).toBeNull()
    expect(v.classification).toBe('no-data')
    expect(v.plannedEnd).toBe('2026-05-05T00:00:00.000Z')
    expect(v.plannedDurationDays).toBe(4)
  })

  it('snapshot sin fechas → no-data, plannedDuration null', () => {
    const v = computeTaskVariance(
      realTask(),
      snapshotEntry({ plannedStart: null, plannedEnd: null }),
    )
    expect(v.classification).toBe('no-data')
    expect(v.plannedDurationDays).toBeNull()
  })
})

describe('baseline-variance · buildVarianceMap', () => {
  it('mapea cada tarea contra su entrada del snapshot por id', () => {
    const map = buildVarianceMap(
      [
        realTask({ id: 't1' }),
        realTask({ id: 't2', endDate: '2026-05-12T00:00:00.000Z' }),
        realTask({ id: 't3' }), // sin entrada en el snapshot
      ],
      {
        tasks: [
          snapshotEntry({ id: 't1' }),
          snapshotEntry({ id: 't2', plannedEnd: '2026-05-05T00:00:00.000Z' }),
        ],
      },
    )
    expect(map.get('t1')?.classification).toBe('on-plan')
    expect(map.get('t2')?.classification).toBe('moderate')
    expect(map.get('t2')?.deltaDays).toBe(7)
    expect(map.get('t3')?.classification).toBe('missing')
  })

  it('snapshot null → mapa vacío (no se renderiza overlay)', () => {
    const map = buildVarianceMap([realTask()], null)
    expect(map.size).toBe(0)
  })
})

describe('baseline-variance · describeBaselineBar', () => {
  it('formatea aria-label con retraso', () => {
    const txt = describeBaselineBar({
      baselineVersion: 3,
      mnemonic: 'PROJ-12',
      plannedStart: '2026-05-02T00:00:00.000Z',
      plannedEnd: '2026-05-08T00:00:00.000Z',
      deltaDays: 3,
    })
    expect(txt).toBe('Línea base v.3 de PROJ-12: 2026-05-02 a 2026-05-08 (3d retraso)')
  })

  it('formatea adelanto y en-plan', () => {
    expect(
      describeBaselineBar({
        baselineVersion: 1,
        mnemonic: null,
        plannedStart: '2026-01-01T00:00:00.000Z',
        plannedEnd: '2026-01-05T00:00:00.000Z',
        deltaDays: -2,
      }),
    ).toContain('2d adelanto')
    expect(
      describeBaselineBar({
        baselineVersion: 2,
        mnemonic: 'A-1',
        plannedStart: '2026-01-01T00:00:00.000Z',
        plannedEnd: '2026-01-05T00:00:00.000Z',
        deltaDays: 0,
      }),
    ).toContain('en plan')
  })
})
