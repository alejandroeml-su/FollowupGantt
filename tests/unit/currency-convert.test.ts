import { describe, it, expect } from 'vitest'

/**
 * Ola P8 · Equipo P8-3 — tests del helper `currency-convert`.
 *
 * Valida la conversión triangulada vía USD usando un lookup en memoria.
 * No toca BD ni red.
 */

import {
  convertCurrency,
  toUsd,
  lookupFromRows,
  roundHalfEven,
  type CurrencyRateRow,
} from '@/lib/cost/currency-convert'

function makeRows(): CurrencyRateRow[] {
  const t = new Date('2026-05-04T00:00:00.000Z')
  return [
    { base: 'USD', quote: 'MXN', rate: 17, fetchedAt: t },
    { base: 'USD', quote: 'EUR', rate: 0.92, fetchedAt: t },
    { base: 'USD', quote: 'JPY', rate: 150, fetchedAt: t },
  ]
}

describe('currency-convert', () => {
  it('amount con misma moneda devuelve el mismo valor', async () => {
    const lookup = lookupFromRows(makeRows())
    expect(await convertCurrency(100, 'USD', 'USD', lookup)).toBe(100)
    expect(await convertCurrency(50, 'MXN', 'MXN', lookup)).toBe(50)
  })

  it('USD → MXN multiplica por rate (17)', async () => {
    const lookup = lookupFromRows(makeRows())
    expect(await convertCurrency(10, 'USD', 'MXN', lookup)).toBe(170)
  })

  it('MXN → USD divide por rate (17)', async () => {
    const lookup = lookupFromRows(makeRows())
    const res = await convertCurrency(170, 'MXN', 'USD', lookup)
    expect(res).toBeCloseTo(10, 2)
  })

  it('EUR → MXN tringulariza vía USD (≈ 18.48)', async () => {
    const lookup = lookupFromRows(makeRows())
    // 100 EUR / 0.92 = 108.69 USD; * 17 = 1847.83 MXN
    const res = await convertCurrency(100, 'EUR', 'MXN', lookup)
    expect(res).toBeCloseTo(1847.83, 1)
  })

  it('toUsd es atajo para convertCurrency(_, _, "USD")', async () => {
    const lookup = lookupFromRows(makeRows())
    const res = await toUsd(100, 'EUR', lookup)
    expect(res).toBeCloseTo(108.7, 1)
  })

  it('devuelve null si falta la rate de la moneda destino', async () => {
    const lookup = lookupFromRows(makeRows())
    expect(await convertCurrency(100, 'USD', 'GBP', lookup)).toBeNull()
  })

  it('devuelve null si falta la rate de la moneda origen', async () => {
    const lookup = lookupFromRows(makeRows())
    expect(await convertCurrency(100, 'GBP', 'USD', lookup)).toBeNull()
  })

  it('lookupFromRows toma la fila con fetchedAt más reciente', async () => {
    const old = { base: 'USD', quote: 'MXN', rate: 18, fetchedAt: new Date('2026-04-01') }
    const fresh = { base: 'USD', quote: 'MXN', rate: 17, fetchedAt: new Date('2026-05-04') }
    const lookup = lookupFromRows([old, fresh])
    const res = await convertCurrency(1, 'USD', 'MXN', lookup)
    expect(res).toBe(17)
  })

  it('lookupFromRows ignora rows con base distinta de USD', async () => {
    const row = { base: 'EUR', quote: 'MXN', rate: 19, fetchedAt: new Date() }
    const lookup = lookupFromRows([row])
    expect(await convertCurrency(1, 'USD', 'MXN', lookup)).toBeNull()
  })

  it('amount no-finite devuelve null', async () => {
    const lookup = lookupFromRows(makeRows())
    expect(await convertCurrency(Number.NaN, 'USD', 'MXN', lookup)).toBeNull()
    expect(await convertCurrency(Number.POSITIVE_INFINITY, 'USD', 'MXN', lookup)).toBeNull()
  })

  it('roundHalfEven aplica banker rounding en .5 exactos', () => {
    expect(roundHalfEven(2.5, 0)).toBe(2)
    expect(roundHalfEven(3.5, 0)).toBe(4)
    expect(roundHalfEven(0.5, 0)).toBe(0)
    expect(roundHalfEven(-0.5, 0)).toBe(0)
  })

  it('roundHalfEven preserva NaN/Infinity', () => {
    expect(Number.isNaN(roundHalfEven(Number.NaN, 2))).toBe(true)
    expect(roundHalfEven(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY)
  })

  it('rate inválida (0 o negativa) devuelve null', async () => {
    const broken: CurrencyRateRow[] = [
      { base: 'USD', quote: 'MXN', rate: 0, fetchedAt: new Date() },
    ]
    const lookup = lookupFromRows(broken)
    expect(await convertCurrency(1, 'USD', 'MXN', lookup)).toBeNull()
  })

  it('normaliza moneda en mayúsculas', async () => {
    const lookup = lookupFromRows(makeRows())
    const res = await convertCurrency(10, 'usd', 'mxn', lookup)
    expect(res).toBe(170)
  })
})
