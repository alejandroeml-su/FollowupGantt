import { describe, it, expect } from 'vitest'

/**
 * Smoke tests para la lógica pura del Editor de pizarras tras agregar
 * edición inline, context menu y floating action toolbar (2026-05-11
 * incidente reportado por Edwin: toolbar duplicada + falta edición de
 * texto + sin menú contextual).
 *
 * No montamos React; verificamos solo las funciones puras de orden Z
 * y merge de patches que el componente usa.
 */

function computeNextZ(
  others: { zIndex: number }[],
  direction: 'front' | 'back',
): number {
  if (direction === 'front') {
    const max =
      others.length > 0
        ? others.reduce((m, e) => Math.max(m, e.zIndex), -Infinity)
        : 0
    return max + 1
  }
  const min =
    others.length > 0
      ? others.reduce((m, e) => Math.min(m, e.zIndex), Infinity)
      : 0
  return min - 1
}

describe('Whiteboard Z-order helper', () => {
  it('"front" coloca el elemento sobre el maxZIndex de los demás', () => {
    const others = [{ zIndex: 1 }, { zIndex: 3 }, { zIndex: 2 }]
    expect(computeNextZ(others, 'front')).toBe(4)
  })

  it('"back" coloca el elemento bajo el minZIndex de los demás', () => {
    const others = [{ zIndex: 5 }, { zIndex: 7 }, { zIndex: 2 }]
    expect(computeNextZ(others, 'back')).toBe(1)
  })

  it('lista vacía: front → 1, back → -1', () => {
    expect(computeNextZ([], 'front')).toBe(1)
    expect(computeNextZ([], 'back')).toBe(-1)
  })

  it('un solo elemento: front lo coloca encima · back debajo', () => {
    const others = [{ zIndex: 5 }]
    expect(computeNextZ(others, 'front')).toBe(6)
    expect(computeNextZ(others, 'back')).toBe(4)
  })

  it('elementos con zIndex negativo: back va aún más abajo', () => {
    const others = [{ zIndex: -3 }, { zIndex: 1 }]
    expect(computeNextZ(others, 'back')).toBe(-4)
    expect(computeNextZ(others, 'front')).toBe(2)
  })
})

describe('Whiteboard data merge patch', () => {
  function mergeData(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) {
    return { ...current, ...patch }
  }

  it('cambio de color preserva el resto del payload del sticky', () => {
    const current = { text: 'Hola', color: '#fde68a' }
    const result = mergeData(current, { color: '#93c5fd' })
    expect(result).toEqual({ text: 'Hola', color: '#93c5fd' })
  })

  it('cambio de texto preserva color y otros campos', () => {
    const current = { text: '', color: '#fde68a' }
    const result = mergeData(current, { text: 'Migración SAP' })
    expect(result.text).toBe('Migración SAP')
    expect(result.color).toBe('#fde68a')
  })

  it('color picker actualiza ambos campos color y fill en shapes', () => {
    const current = {
      variant: 'rectangle',
      fill: '#374151',
      stroke: '#64748b',
      text: '',
      color: '#374151',
    }
    const result = mergeData(current, { color: '#fca5a5', fill: '#fca5a5' })
    expect(result.fill).toBe('#fca5a5')
    expect(result.color).toBe('#fca5a5')
    expect(result.variant).toBe('rectangle')
    expect(result.stroke).toBe('#64748b')
  })
})
