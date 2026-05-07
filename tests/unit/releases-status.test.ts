import { describe, it, expect } from 'vitest'
import {
  averageProgress,
  daysUntil,
  deriveReleaseStatus,
  releaseStatusLabel,
} from '@/lib/releases/status'

describe('releases · deriveReleaseStatus', () => {
  it('RELEASED si releasedDate no null', () => {
    expect(
      deriveReleaseStatus({
        plannedDate: '2026-01-01',
        releasedDate: '2026-01-15',
      }),
    ).toBe('RELEASED')
  })

  it('DELAYED si plannedDate ya pasó y no released', () => {
    const now = new Date('2026-06-01')
    expect(
      deriveReleaseStatus(
        { plannedDate: '2026-05-01', releasedDate: null },
        now,
      ),
    ).toBe('DELAYED')
  })

  it('AT_RISK si planned <= 7d y progress < 50%', () => {
    const now = new Date('2026-06-01')
    expect(
      deriveReleaseStatus(
        {
          plannedDate: '2026-06-05',
          releasedDate: null,
          progressPct: 30,
        },
        now,
      ),
    ).toBe('AT_RISK')
  })

  it('ON_TRACK si planned > 7d aunque progress sea bajo', () => {
    const now = new Date('2026-06-01')
    expect(
      deriveReleaseStatus(
        {
          plannedDate: '2026-09-01',
          releasedDate: null,
          progressPct: 10,
        },
        now,
      ),
    ).toBe('ON_TRACK')
  })

  it('ON_TRACK si planned <=7d pero progress >= 50%', () => {
    const now = new Date('2026-06-01')
    expect(
      deriveReleaseStatus(
        {
          plannedDate: '2026-06-05',
          releasedDate: null,
          progressPct: 60,
        },
        now,
      ),
    ).toBe('ON_TRACK')
  })

  it('progressPct null → asume 0', () => {
    const now = new Date('2026-06-01')
    expect(
      deriveReleaseStatus(
        {
          plannedDate: '2026-06-03',
          releasedDate: null,
          progressPct: null,
        },
        now,
      ),
    ).toBe('AT_RISK')
  })
})

describe('releases · averageProgress', () => {
  it('array vacío → null', () => {
    expect(averageProgress([])).toBeNull()
  })

  it('todos null → null', () => {
    expect(averageProgress([null, null, undefined])).toBeNull()
  })

  it('promedio entero', () => {
    expect(averageProgress([0, 50, 100])).toBe(50)
  })

  it('ignora null/undefined/NaN', () => {
    expect(averageProgress([100, null, 50, NaN, undefined, 0])).toBe(50)
  })
})

describe('releases · daysUntil', () => {
  it('positivo si planned futuro', () => {
    const now = new Date('2026-06-01T12:00:00Z')
    expect(daysUntil('2026-06-08T12:00:00Z', now)).toBe(7)
  })

  it('negativo si planned ya pasó', () => {
    const now = new Date('2026-06-08T12:00:00Z')
    expect(daysUntil('2026-06-01T12:00:00Z', now)).toBe(-7)
  })

  it('cero si planned es hoy mismo', () => {
    const now = new Date('2026-06-08T08:00:00Z')
    expect(daysUntil('2026-06-08T20:00:00Z', now)).toBe(0)
  })
})

describe('releases · releaseStatusLabel', () => {
  it('mapea cada status a su label es-MX', () => {
    expect(releaseStatusLabel('RELEASED')).toBe('Liberada')
    expect(releaseStatusLabel('DELAYED')).toBe('Atrasada')
    expect(releaseStatusLabel('AT_RISK')).toBe('En riesgo')
    expect(releaseStatusLabel('ON_TRACK')).toBe('En curso')
  })
})
