import { describe, it, expect } from 'vitest'
import {
  computeBurndown,
  computeSprintMetrics,
  isValidStoryPoints,
  FIBONACCI_STORY_POINTS,
} from '@/lib/agile/burndown'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('agile/burndown · computeBurndown', () => {
  it('genera N+1 puntos desde startDate hasta endDate (inclusive)', () => {
    // 2026-05-01 → 2026-05-05 = 4 días de diferencia ⇒ 5 puntos (día 0..4).
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-05'), capacity: 20 },
      [],
      utc('2026-05-01'),
    )
    expect(points).toHaveLength(5)
    expect(points[0]?.day).toBe(0)
    expect(points[4]?.day).toBe(4)
    expect(points[0]?.date).toBe('2026-05-01')
    expect(points[4]?.date).toBe('2026-05-05')
  })

  it('línea ideal decae linealmente de capacity a 0', () => {
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-05'), capacity: 20 },
      [],
      utc('2026-05-05'),
    )
    expect(points[0]?.idealRemaining).toBe(20)
    expect(points[4]?.idealRemaining).toBe(0)
    // mitad del sprint (día 2 de 4) = mitad de la capacity.
    expect(points[2]?.idealRemaining).toBeCloseTo(10, 0)
  })

  it('actualRemaining es null para días futuros', () => {
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-10'), capacity: 10 },
      [],
      utc('2026-05-03'),
    )
    // Hoy = día 2 ⇒ days 0..2 tienen valor, days 3..9 son null.
    expect(points[0]?.actualRemaining).not.toBeNull()
    expect(points[2]?.actualRemaining).not.toBeNull()
    expect(points[3]?.actualRemaining).toBeNull()
    expect(points[9]?.actualRemaining).toBeNull()
  })

  it('actualRemaining suma puntos NO completados al día evaluado', () => {
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-05'), capacity: 13 },
      [
        { status: 'TODO', storyPoints: 5 },
        { status: 'IN_PROGRESS', storyPoints: 3 },
        { status: 'DONE', storyPoints: 5, updatedAt: utc('2026-05-03') },
      ],
      utc('2026-05-05'),
    )
    // Día 0: nada cerrado → 13 puntos restantes.
    expect(points[0]?.actualRemaining).toBe(13)
    // Día 2: cierre del DONE = día 2; closedDay (2) NO es > day (2),
    // luego cuenta como cerrada en el día 2 ⇒ restantes = 5 + 3 = 8.
    expect(points[2]?.actualRemaining).toBe(8)
    // Día 3 y 4: misma situación.
    expect(points[3]?.actualRemaining).toBe(8)
    expect(points[4]?.actualRemaining).toBe(8)
  })

  it('si capacity es nullish usa la suma de storyPoints', () => {
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-02'), capacity: null },
      [
        { status: 'TODO', storyPoints: 8 },
        { status: 'TODO', storyPoints: 5 },
      ],
      utc('2026-05-02'),
    )
    // 2 puntos: día 0 y día 1.
    expect(points).toHaveLength(2)
    expect(points[0]?.idealRemaining).toBe(13)
    expect(points[1]?.idealRemaining).toBe(0)
  })

  it('ignora tareas con storyPoints null o no positivos', () => {
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-02'), capacity: 5 },
      [
        { status: 'TODO', storyPoints: 5 },
        { status: 'TODO', storyPoints: null },
        { status: 'TODO', storyPoints: 0 },
      ],
      utc('2026-05-02'),
    )
    expect(points[0]?.actualRemaining).toBe(5)
  })

  it('soporta sprints de 1 día sin division-by-zero', () => {
    const points = computeBurndown(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-01'), capacity: 5 },
      [],
      utc('2026-05-01'),
    )
    expect(points).toHaveLength(1)
    expect(points[0]?.idealRemaining).toBe(0)
  })
})

describe('agile/burndown · computeSprintMetrics', () => {
  it('calcula totalPoints, completedPoints y completionRate', () => {
    const m = computeSprintMetrics([
      { status: 'TODO', storyPoints: 3 },
      { status: 'DONE', storyPoints: 5 },
      { status: 'IN_PROGRESS', storyPoints: 2 },
      { status: 'DONE', storyPoints: 8 },
    ])
    expect(m.totalPoints).toBe(18)
    expect(m.completedPoints).toBe(13)
    expect(m.remainingPoints).toBe(5)
    expect(m.completionRate).toBeCloseTo(13 / 18, 5)
  })

  it('completionRate = 0 cuando no hay puntos', () => {
    const m = computeSprintMetrics([])
    expect(m.totalPoints).toBe(0)
    expect(m.completionRate).toBe(0)
  })
})

describe('agile/burndown · isValidStoryPoints', () => {
  it('acepta valores Fibonacci canónicos', () => {
    for (const v of FIBONACCI_STORY_POINTS) {
      expect(isValidStoryPoints(v)).toBe(true)
    }
  })

  it('rechaza valores fuera de la escala', () => {
    expect(isValidStoryPoints(0)).toBe(false)
    expect(isValidStoryPoints(4)).toBe(false)
    expect(isValidStoryPoints(7)).toBe(false)
    expect(isValidStoryPoints(100)).toBe(false)
    expect(isValidStoryPoints(-1)).toBe(false)
    expect(isValidStoryPoints(1.5)).toBe(false)
    expect(isValidStoryPoints('5')).toBe(false)
    expect(isValidStoryPoints(null)).toBe(false)
    expect(isValidStoryPoints(undefined)).toBe(false)
  })
})
