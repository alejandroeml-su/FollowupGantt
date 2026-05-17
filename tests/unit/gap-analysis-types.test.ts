import { describe, it, expect } from 'vitest'

import {
  computeGapColor,
  computeGapMagnitude,
} from '@/lib/gap-analysis/types'

/**
 * US-9.2 · Wave R5 — Tests del cálculo de gap y color cualitativo.
 *
 * Verifica los umbrales documentados en `types.ts`:
 *   - neutral cuando falta valor.
 *   - green cuando AS-IS ≥ TO-BE.
 *   - amber cuando |gap| ≤ 25% del TO-BE.
 *   - red en cualquier otro caso.
 */

describe('computeGapMagnitude', () => {
  it('devuelve null si falta cualquiera de los valores', () => {
    expect(computeGapMagnitude(null, 100)).toBeNull()
    expect(computeGapMagnitude(80, null)).toBeNull()
    expect(computeGapMagnitude(undefined, undefined)).toBeNull()
  })

  it('calcula TO-BE − AS-IS', () => {
    expect(computeGapMagnitude(80, 100)).toBe(20)
    expect(computeGapMagnitude(100, 80)).toBe(-20)
    expect(computeGapMagnitude(0, 0)).toBe(0)
  })

  it('redondea a 4 decimales para evitar drift de Float', () => {
    expect(computeGapMagnitude(0.1, 0.3)).toBe(0.2)
  })
})

describe('computeGapColor', () => {
  it('devuelve neutral si falta cualquier valor', () => {
    expect(computeGapColor(null, 100)).toBe('neutral')
    expect(computeGapColor(80, undefined)).toBe('neutral')
  })

  it('devuelve green cuando AS-IS supera o iguala al TO-BE', () => {
    expect(computeGapColor(100, 100)).toBe('green')
    expect(computeGapColor(120, 100)).toBe('green')
  })

  it('devuelve amber con gap ≤ 25% del TO-BE', () => {
    // Gap = 20 sobre 100 = 20% → amber
    expect(computeGapColor(80, 100)).toBe('amber')
    expect(computeGapColor(75, 100)).toBe('amber')
  })

  it('devuelve red con gap > 25% del TO-BE', () => {
    // Gap = 30 sobre 100 = 30% → red
    expect(computeGapColor(70, 100)).toBe('red')
    expect(computeGapColor(0, 100)).toBe('red')
  })

  it('maneja el caso especial TO-BE = 0', () => {
    // Si el objetivo es no tener nada, asIs<=0 es green
    expect(computeGapColor(0, 0)).toBe('green')
    expect(computeGapColor(-1, 0)).toBe('green')
    expect(computeGapColor(1, 0)).toBe('red')
  })

  it('soporta dirección "menos es mejor" (TO-BE negativo)', () => {
    // Si TO-BE=-10 (queremos −10 días, o "reducir métrica") y AS-IS=-10 → green
    expect(computeGapColor(-10, -10)).toBe('green')
    // AS-IS=-9 con TO-BE=-10 → gap=|1|/|10|=10% → amber
    expect(computeGapColor(-9, -10)).toBe('amber')
    // AS-IS=0 con TO-BE=-10 → gap=10/10=100% → red
    expect(computeGapColor(0, -10)).toBe('red')
  })
})
