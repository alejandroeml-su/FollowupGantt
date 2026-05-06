import { describe, it, expect } from 'vitest'
import {
  computeRolledUpProgress,
  computeProgressWithSource,
} from '@/lib/progress/rollup'

describe('computeRolledUpProgress', () => {
  it('hoja sin subtareas → progress directo', () => {
    expect(computeRolledUpProgress({ progress: 50 })).toBe(50)
    expect(computeRolledUpProgress({ progress: 0 })).toBe(0)
    expect(computeRolledUpProgress({ progress: 100 })).toBe(100)
  })

  it('tarea con subtareas → promedio simple', () => {
    expect(
      computeRolledUpProgress({
        progress: 0,
        subtasks: [{ progress: 100 }, { progress: 50 }],
      }),
    ).toBe(75)
  })

  it('promedio se redondea al entero', () => {
    expect(
      computeRolledUpProgress({
        progress: 0,
        subtasks: [
          { progress: 100 },
          { progress: 50 },
          { progress: 33 },
        ],
      }),
    ).toBe(61) // (100+50+33)/3 = 61
  })

  it('subtareas archivadas se excluyen', () => {
    expect(
      computeRolledUpProgress({
        progress: 0,
        subtasks: [
          { progress: 100 },
          { progress: 0, archivedAt: new Date() },
          { progress: 50 },
        ],
      }),
    ).toBe(75) // ignora la archivada → (100+50)/2
  })

  it('todas las subtareas archivadas → no recursive, usa progress propio', () => {
    expect(
      computeRolledUpProgress({
        progress: 30,
        subtasks: [
          { progress: 100, archivedAt: new Date() },
        ],
      }),
    ).toBe(30)
  })

  it('recursivo: subtarea con sub-subtareas', () => {
    expect(
      computeRolledUpProgress({
        progress: 0,
        subtasks: [
          {
            progress: 0,
            subtasks: [
              { progress: 100 },
              { progress: 0 },
            ],
          },
          { progress: 100 },
        ],
      }),
    ).toBe(75) // sub1=50, sub2=100 → (50+100)/2 = 75
  })

  it('clamp 0..100', () => {
    expect(computeRolledUpProgress({ progress: 150 })).toBe(100)
    expect(computeRolledUpProgress({ progress: -10 })).toBe(0)
    expect(computeRolledUpProgress({ progress: NaN })).toBe(0)
  })

  it('cuando progress=null/undefined → 0', () => {
    expect(
      computeRolledUpProgress({ progress: undefined as unknown as number }),
    ).toBe(0)
  })

  it('subtasks null o undefined se trata como sin subs', () => {
    expect(computeRolledUpProgress({ progress: 60, subtasks: null })).toBe(60)
    expect(
      computeRolledUpProgress({ progress: 60, subtasks: undefined }),
    ).toBe(60)
  })
})

describe('computeProgressWithSource', () => {
  it('hoja → derived=false, childCount=0', () => {
    expect(computeProgressWithSource({ progress: 40 })).toEqual({
      percent: 40,
      derived: false,
      childCount: 0,
    })
  })

  it('con subs → derived=true, childCount=N', () => {
    expect(
      computeProgressWithSource({
        progress: 0,
        subtasks: [{ progress: 100 }, { progress: 50 }],
      }),
    ).toEqual({ percent: 75, derived: true, childCount: 2 })
  })

  it('archivadas se excluyen también del childCount', () => {
    expect(
      computeProgressWithSource({
        progress: 0,
        subtasks: [
          { progress: 100 },
          { progress: 0, archivedAt: '2026-01-01' },
        ],
      }),
    ).toEqual({ percent: 100, derived: true, childCount: 1 })
  })
})
