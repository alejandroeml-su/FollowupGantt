import { describe, it, expect } from 'vitest'

import {
  PRICING_TIERS,
  TIER_ORDER,
  getTierLimits,
  tierIncludesFeature,
  tierAllowsCapacity,
  getStripePriceIdForTier,
} from '@/lib/billing/pricing'

describe('PRICING_TIERS catalog', () => {
  it('expone los 3 tiers FREE/PRO/ENTERPRISE en orden', () => {
    expect(TIER_ORDER).toEqual(['FREE', 'PRO', 'ENTERPRISE'])
    expect(Object.keys(PRICING_TIERS).sort()).toEqual(
      ['ENTERPRISE', 'FREE', 'PRO'].sort(),
    )
  })

  it('FREE caps coinciden con spec (3 users, 1 proyecto, 50 brain calls)', () => {
    expect(PRICING_TIERS.FREE.users).toBe(3)
    expect(PRICING_TIERS.FREE.projects).toBe(1)
    expect(PRICING_TIERS.FREE.brainCalls).toBe(50)
    expect(PRICING_TIERS.FREE.priceMonthly).toBe(0)
  })

  it('PRO incluye evm, monte_carlo, realtime', () => {
    expect(PRICING_TIERS.PRO.features).toContain('evm')
    expect(PRICING_TIERS.PRO.features).toContain('monte_carlo')
    expect(PRICING_TIERS.PRO.features).toContain('realtime')
  })

  it('ENTERPRISE usa wildcard * y users -1 (unlimited)', () => {
    expect(PRICING_TIERS.ENTERPRISE.features).toContain('*')
    expect(PRICING_TIERS.ENTERPRISE.users).toBe(-1)
    expect(PRICING_TIERS.ENTERPRISE.projects).toBe(-1)
  })
})

describe('getTierLimits', () => {
  it('devuelve FREE para tier desconocido o null', () => {
    expect(getTierLimits(null).priceMonthly).toBe(0)
    expect(getTierLimits('UNKNOWN_PLAN').priceMonthly).toBe(0)
    expect(getTierLimits(undefined).priceMonthly).toBe(0)
  })

  it('devuelve PRO cuando se pasa exactamente PRO', () => {
    expect(getTierLimits('PRO').priceMonthly).toBe(10)
  })
})

describe('tierIncludesFeature', () => {
  it('FREE incluye gantt y kanban', () => {
    expect(tierIncludesFeature('FREE', 'gantt')).toBe(true)
    expect(tierIncludesFeature('FREE', 'kanban')).toBe(true)
  })

  it('FREE NO incluye evm ni monte_carlo', () => {
    expect(tierIncludesFeature('FREE', 'evm')).toBe(false)
    expect(tierIncludesFeature('FREE', 'monte_carlo')).toBe(false)
  })

  it('PRO incluye monte_carlo pero NO sso', () => {
    expect(tierIncludesFeature('PRO', 'monte_carlo')).toBe(true)
    expect(tierIncludesFeature('PRO', 'sso')).toBe(false)
  })

  it('ENTERPRISE incluye cualquier feature (wildcard) y también sso', () => {
    expect(tierIncludesFeature('ENTERPRISE', 'this_feature_does_not_exist')).toBe(true)
    expect(tierIncludesFeature('ENTERPRISE', 'sso')).toBe(true)
    expect(tierIncludesFeature('ENTERPRISE', 'siem')).toBe(true)
  })
})

describe('tierAllowsCapacity', () => {
  it('FREE permite hasta 3 users (current<3 ok, >=3 deny)', () => {
    expect(tierAllowsCapacity('FREE', 'users', 0)).toBe(true)
    expect(tierAllowsCapacity('FREE', 'users', 2)).toBe(true)
    expect(tierAllowsCapacity('FREE', 'users', 3)).toBe(false)
    expect(tierAllowsCapacity('FREE', 'users', 10)).toBe(false)
  })

  it('ENTERPRISE permite users sin límite (-1 = ∞)', () => {
    expect(tierAllowsCapacity('ENTERPRISE', 'users', 1_000_000)).toBe(true)
    expect(tierAllowsCapacity('ENTERPRISE', 'projects', 999)).toBe(true)
  })

  it('PRO permite hasta 10 proyectos', () => {
    expect(tierAllowsCapacity('PRO', 'projects', 9)).toBe(true)
    expect(tierAllowsCapacity('PRO', 'projects', 10)).toBe(false)
  })
})

describe('getStripePriceIdForTier', () => {
  it('FREE siempre devuelve null', () => {
    expect(getStripePriceIdForTier('FREE')).toBeNull()
  })

  it('PRO devuelve STRIPE_PRICE_PRO_MONTHLY env var', () => {
    const prev = process.env.STRIPE_PRICE_PRO_MONTHLY
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_test_pro_123'
    expect(getStripePriceIdForTier('PRO')).toBe('price_test_pro_123')
    process.env.STRIPE_PRICE_PRO_MONTHLY = prev
  })

  it('PRO devuelve null si la env var está ausente', () => {
    const prev = process.env.STRIPE_PRICE_PRO_MONTHLY
    delete process.env.STRIPE_PRICE_PRO_MONTHLY
    expect(getStripePriceIdForTier('PRO')).toBeNull()
    if (prev !== undefined) process.env.STRIPE_PRICE_PRO_MONTHLY = prev
  })
})
