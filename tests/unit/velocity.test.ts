import { describe, it, expect } from 'vitest'
import { computeVelocity } from '@/lib/agile/burndown'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('agile/burndown · computeVelocity', () => {
  it('devuelve un punto por sprint con campos canonicos', () => {
    const r = computeVelocity([
      {
        id: 's1',
        name: 'Sprint 1',
        capacity: 20,
        velocityActual: 18,
        endedAt: utc('2026-04-01'),
      },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({
      sprintId: 's1',
      sprintName: 'Sprint 1',
      capacity: 20,
      velocityActual: 18,
    })
  })

  it('ordena cronológicamente ascendente por endedAt', () => {
    const r = computeVelocity([
      { id: 's3', name: 'S3', capacity: 10, velocityActual: 9, endedAt: utc('2026-04-15') },
      { id: 's1', name: 'S1', capacity: 8, velocityActual: 7, endedAt: utc('2026-04-01') },
      { id: 's2', name: 'S2', capacity: 12, velocityActual: 10, endedAt: utc('2026-04-08') },
    ])
    expect(r.map((p) => p.sprintId)).toEqual(['s1', 's2', 's3'])
  })

  it('usa endDate como fallback si endedAt está vacío', () => {
    const r = computeVelocity([
      { id: 's1', name: 'S1', capacity: 10, velocityActual: null, endDate: utc('2026-05-15') },
      { id: 's2', name: 'S2', capacity: 10, velocityActual: null, endDate: utc('2026-04-15') },
    ])
    expect(r.map((p) => p.sprintId)).toEqual(['s2', 's1'])
  })

  it('reporta 0 cuando capacity / velocityActual son nulos', () => {
    const r = computeVelocity([
      { id: 's1', name: 'S1', capacity: null, velocityActual: null, endedAt: utc('2026-04-01') },
    ])
    expect(r[0]?.capacity).toBe(0)
    expect(r[0]?.velocityActual).toBe(0)
  })

  it('no muta el array de entrada', () => {
    const input = [
      { id: 's1', name: 'S1', capacity: 5, velocityActual: 4, endedAt: utc('2026-04-15') },
      { id: 's2', name: 'S2', capacity: 7, velocityActual: 6, endedAt: utc('2026-04-01') },
    ]
    const beforeIds = input.map((x) => x.id)
    computeVelocity(input)
    expect(input.map((x) => x.id)).toEqual(beforeIds)
  })
})
