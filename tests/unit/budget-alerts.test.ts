import { describe, it, expect, vi } from 'vitest'

/**
 * Ola P8 · Equipo P8-3 — tests de `budget-alerts`.
 */

import {
  detectBudgetAlerts,
  buildBudgetSnapshots,
  dispatchBudgetAlerts,
} from '@/lib/cost/budget-alerts'
import type { BudgetSnapshot } from '@/lib/cost/expense-types'

function snap(over: Partial<BudgetSnapshot>): BudgetSnapshot {
  return {
    scopeId: 'p1',
    scopeType: 'project',
    budget: 1000,
    currency: 'USD',
    budgetUsd: 1000,
    actualUsd: 500,
    utilization: 0.5,
    ...over,
  }
}

describe('detectBudgetAlerts', () => {
  it('no emite eventos si utilization < threshold mínimo', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 0.5 })],
      names: { p1: 'Proyecto Alpha' },
    })
    expect(events).toHaveLength(0)
  })

  it('emite con threshold 0.75 cuando utilization 0.8', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 0.8, actualUsd: 800 })],
      names: { p1: 'Proyecto Alpha' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].threshold).toBe(0.75)
    expect(events[0].scopeName).toBe('Proyecto Alpha')
  })

  it('elige el threshold MÁS ALTO cruzado (1.0 > 0.9 > 0.75)', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 1.05, actualUsd: 1050 })],
      names: { p1: 'Proyecto Alpha' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].threshold).toBe(1.0)
  })

  it('skipea snapshots con budgetUsd <= 0', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ budgetUsd: 0, utilization: 5 })],
      names: { p1: 'Sin presupuesto' },
    })
    expect(events).toHaveLength(0)
  })

  it('skipea snapshots con utilization no finita', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: Number.NaN })],
      names: { p1: 'Proyecto Alpha' },
    })
    expect(events).toHaveLength(0)
  })

  it('thresholds custom funcionan en orden DESC', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 0.6 })],
      names: { p1: 'X' },
      thresholds: [0.5, 0.3],
    })
    expect(events).toHaveLength(1)
    expect(events[0].threshold).toBe(0.5)
  })

  it('thresholds vacío → silencio total', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 5 })],
      names: { p1: 'X' },
      thresholds: [],
    })
    expect(events).toHaveLength(0)
  })

  it('usa scopeId si no hay name en el mapa', () => {
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 1.0 })],
      names: {},
    })
    expect(events[0].scopeName).toBe('p1')
  })

  it('triggeredAt usa el `now` inyectado', () => {
    const now = new Date('2026-05-04T12:00:00.000Z')
    const events = detectBudgetAlerts({
      snapshots: [snap({ utilization: 1.2 })],
      names: { p1: 'X' },
      now,
    })
    expect(events[0].triggeredAt).toBe(now.toISOString())
  })
})

describe('buildBudgetSnapshots', () => {
  it('omite scopes sin budget definido', () => {
    const out = buildBudgetSnapshots(
      [{ scopeId: 'a', scopeType: 'project', budget: null, currency: null }],
      { a: 100 },
      {},
    )
    expect(out).toHaveLength(0)
  })

  it('USD budget → budgetUsd igual a budget', () => {
    const out = buildBudgetSnapshots(
      [{ scopeId: 'a', scopeType: 'project', budget: 1000, currency: 'USD' }],
      { a: 250 },
      {},
    )
    expect(out[0].budgetUsd).toBe(1000)
    expect(out[0].utilization).toBe(0.25)
  })

  it('moneda no-USD requiere budgetUsdByScope', () => {
    const out = buildBudgetSnapshots(
      [{ scopeId: 'a', scopeType: 'project', budget: 17000, currency: 'MXN' }],
      { a: 500 },
      { a: 1000 },
    )
    expect(out[0].budgetUsd).toBe(1000)
    expect(out[0].utilization).toBe(0.5)
  })
})

describe('dispatchBudgetAlerts', () => {
  it('emite budget.threshold_breached si util ≤ 1.0', async () => {
    const dispatcher = vi.fn().mockResolvedValue(undefined)
    const events = [
      {
        scopeId: 'p1',
        scopeType: 'project' as const,
        scopeName: 'Alpha',
        budgetUsd: 1000,
        actualUsd: 800,
        utilization: 0.8,
        threshold: 0.75,
        triggeredAt: new Date().toISOString(),
      },
    ]
    const r = await dispatchBudgetAlerts(events, dispatcher)
    expect(r.dispatched).toBe(1)
    expect(dispatcher).toHaveBeenCalledWith('budget.threshold_breached', expect.any(Object))
  })

  it('emite budget.overrun si util > 1.0', async () => {
    const dispatcher = vi.fn().mockResolvedValue(undefined)
    const events = [
      {
        scopeId: 'p1',
        scopeType: 'project' as const,
        scopeName: 'Alpha',
        budgetUsd: 1000,
        actualUsd: 1200,
        utilization: 1.2,
        threshold: 1.0,
        triggeredAt: new Date().toISOString(),
      },
    ]
    await dispatchBudgetAlerts(events, dispatcher)
    expect(dispatcher).toHaveBeenCalledWith('budget.overrun', expect.any(Object))
  })

  it('continua dispatch tras error best-effort', async () => {
    const dispatcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    const events = [
      {
        scopeId: 'p1',
        scopeType: 'project' as const,
        scopeName: 'Alpha',
        budgetUsd: 1000,
        actualUsd: 800,
        utilization: 0.8,
        threshold: 0.75,
        triggeredAt: '2026-05-04T00:00:00.000Z',
      },
      {
        scopeId: 'p2',
        scopeType: 'phase' as const,
        scopeName: 'Beta',
        budgetUsd: 500,
        actualUsd: 400,
        utilization: 0.8,
        threshold: 0.75,
        triggeredAt: '2026-05-04T00:00:00.000Z',
      },
    ]
    // Silenciar warn ruidoso del best-effort logger.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await dispatchBudgetAlerts(events, dispatcher)
    warnSpy.mockRestore()
    expect(r.dispatched).toBe(1)
    expect(r.failed).toBe(1)
    expect(dispatcher).toHaveBeenCalledTimes(2)
  })
})
