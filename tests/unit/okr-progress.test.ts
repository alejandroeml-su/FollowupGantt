import { describe, it, expect } from 'vitest'

import {
  classifyGoalStatus,
  computeGoalProgress,
  computeKeyResultProgress,
  isValidCycle,
} from '@/lib/okr/progress'

/**
 * Ola P2 · Equipo P2-4 — Tests del helper puro `okr/progress.ts`.
 *
 * Cubre las cuatro métricas de KR + edge cases (NaN/Infinity/división por
 * cero), promedio de Goal y la heurística `classifyGoalStatus`.
 */

describe('computeKeyResultProgress', () => {
  it('PERCENT: clamp a 0-100 y respeta currentValue intermedio', () => {
    expect(
      computeKeyResultProgress({
        id: 'kr',
        metric: 'PERCENT',
        targetValue: 100,
        currentValue: 42,
      }),
    ).toBe(42)
    expect(
      computeKeyResultProgress({
        id: 'kr',
        metric: 'PERCENT',
        targetValue: 100,
        currentValue: 250,
      }),
    ).toBe(100)
    expect(
      computeKeyResultProgress({
        id: 'kr',
        metric: 'PERCENT',
        targetValue: 100,
        currentValue: -10,
      }),
    ).toBe(0)
  })

  it('NUMERIC: ratio currentValue/targetValue * 100', () => {
    expect(
      computeKeyResultProgress({
        id: 'kr',
        metric: 'NUMERIC',
        targetValue: 200,
        currentValue: 50,
      }),
    ).toBe(25)
  })

  it('NUMERIC: target=0 devuelve 0 (no NaN/Infinity)', () => {
    const out = computeKeyResultProgress({
      id: 'kr',
      metric: 'NUMERIC',
      targetValue: 0,
      currentValue: 1,
    })
    expect(out).toBe(0)
    expect(Number.isFinite(out)).toBe(true)
  })

  it('BOOLEAN: 1=100, 0=0', () => {
    expect(
      computeKeyResultProgress({ id: 'k', metric: 'BOOLEAN', targetValue: 1, currentValue: 1 }),
    ).toBe(100)
    expect(
      computeKeyResultProgress({ id: 'k', metric: 'BOOLEAN', targetValue: 1, currentValue: 0 }),
    ).toBe(0)
  })

  it('TASKS_COMPLETED: porcentaje según status DONE', () => {
    const tasks = [
      { id: 't1', status: 'DONE' as const },
      { id: 't2', status: 'DONE' as const },
      { id: 't3', status: 'TODO' as const },
      { id: 't4', status: 'IN_PROGRESS' as const },
    ]
    expect(
      computeKeyResultProgress(
        { id: 'k', metric: 'TASKS_COMPLETED', targetValue: 100, currentValue: 0 },
        tasks,
      ),
    ).toBe(50)
  })

  it('TASKS_COMPLETED: sin tareas vinculadas devuelve 0 (no NaN)', () => {
    const out = computeKeyResultProgress(
      { id: 'k', metric: 'TASKS_COMPLETED', targetValue: 100, currentValue: 0 },
      [],
    )
    expect(out).toBe(0)
  })
})

describe('computeGoalProgress', () => {
  it('promedia los KRs uniformemente', () => {
    const goal = {
      keyResults: [
        { id: 'a', metric: 'PERCENT' as const, targetValue: 100, currentValue: 80 },
        { id: 'b', metric: 'PERCENT' as const, targetValue: 100, currentValue: 20 },
      ],
    }
    expect(computeGoalProgress(goal)).toBe(50)
  })

  it('Goal sin KRs => 0', () => {
    expect(computeGoalProgress({ keyResults: [] })).toBe(0)
  })
})

describe('classifyGoalStatus', () => {
  it('progress en línea con tiempo => ON_TRACK', () => {
    // 50% del ciclo, 50% progreso → diff=0 → ON_TRACK
    expect(classifyGoalStatus(50, 5, 10)).toBe('ON_TRACK')
  })

  it('progress 25% por debajo => AT_RISK', () => {
    // 50% del ciclo, 30% progreso → diff=-20 → AT_RISK
    expect(classifyGoalStatus(30, 5, 10)).toBe('AT_RISK')
  })

  it('progress muy por debajo => OFF_TRACK', () => {
    // 50% del ciclo, 10% progreso → diff=-40 → OFF_TRACK
    expect(classifyGoalStatus(10, 5, 10)).toBe('OFF_TRACK')
  })

  it('al final del ciclo con 100% => COMPLETED', () => {
    expect(classifyGoalStatus(100, 10, 10)).toBe('COMPLETED')
  })

  it('al final del ciclo sin completar => OFF_TRACK', () => {
    expect(classifyGoalStatus(80, 10, 10)).toBe('OFF_TRACK')
  })

  it('antes de iniciar el ciclo => ON_TRACK por defecto', () => {
    expect(classifyGoalStatus(0, 0, 30)).toBe('ON_TRACK')
    expect(classifyGoalStatus(0, -1, 30)).toBe('ON_TRACK')
  })

  it('totalDays inválido => ON_TRACK (defensa)', () => {
    expect(classifyGoalStatus(0, 1, 0)).toBe('ON_TRACK')
    expect(classifyGoalStatus(0, 1, NaN)).toBe('ON_TRACK')
  })
})

describe('isValidCycle', () => {
  it('acepta formatos canónicos', () => {
    expect(isValidCycle('Q1-2026')).toBe(true)
    expect(isValidCycle('Q4-2030')).toBe(true)
    expect(isValidCycle('H1-2026')).toBe(true)
    expect(isValidCycle('H2-2026')).toBe(true)
    expect(isValidCycle('Y2026')).toBe(true)
  })

  it('rechaza inválidos', () => {
    expect(isValidCycle('Q5-2026')).toBe(false)
    expect(isValidCycle('Q1 2026')).toBe(false)
    expect(isValidCycle('q1-2026')).toBe(false)
    expect(isValidCycle('')).toBe(false)
    expect(isValidCycle('2026')).toBe(false)
  })
})
