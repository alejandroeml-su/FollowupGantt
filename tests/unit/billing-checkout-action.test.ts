import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R4-E · Tests del endpoint POST /api/billing/checkout.
 *
 * Mockeamos requireWorkspaceManager + Stripe + subscription para validar:
 *   - Auth gating (UNAUTHORIZED/FORBIDDEN).
 *   - Body validation (INVALID_INPUT).
 *   - Flujo feliz (200 con url + sessionId).
 *   - Manejo de errores Stripe.
 */

const requireManagerMock = vi.fn()
const customerMock = vi.fn()
const checkoutMock = vi.fn()
const upsertMock = vi.fn()
const getSubMock = vi.fn()
const findWsMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/auth/check-workspace-access', () => ({
  requireWorkspaceManager: (...args: unknown[]) => requireManagerMock(...args),
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  getOrCreateStripeCustomer: (...args: unknown[]) => customerMock(...args),
  createCheckoutSession: (...args: unknown[]) => checkoutMock(...args),
}))

vi.mock('@/lib/billing/subscription', () => ({
  getWorkspaceSubscription: (...args: unknown[]) => getSubMock(...args),
  upsertSubscriptionFromStripe: (...args: unknown[]) => upsertMock(...args),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    workspace: { findUnique: (...args: unknown[]) => findWsMock(...args) },
  },
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) => auditMock(...args),
}))

function makeRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  requireManagerMock.mockReset()
  customerMock.mockReset()
  checkoutMock.mockReset()
  upsertMock.mockReset().mockResolvedValue(undefined)
  getSubMock.mockReset()
  findWsMock.mockReset()
  auditMock.mockReset()
})

describe('POST /api/billing/checkout', () => {
  it('400 si body no es JSON', async () => {
    const { POST } = await import('@/app/api/billing/checkout/route')
    const req = {
      json: async () => {
        throw new Error('bad body')
      },
    } as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('400 si falta workspaceId', async () => {
    const { POST } = await import('@/app/api/billing/checkout/route')
    const res = await POST(makeRequest({ tier: 'PRO' }))
    const json = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(400)
    expect(json.error.code).toBe('INVALID_INPUT')
  })

  it('400 si tier es FREE (no permitido en checkout)', async () => {
    const { POST } = await import('@/app/api/billing/checkout/route')
    const res = await POST(makeRequest({ workspaceId: 'ws-1', tier: 'FREE' }))
    expect(res.status).toBe(400)
  })

  it('403 si requireWorkspaceManager lanza FORBIDDEN', async () => {
    requireManagerMock.mockRejectedValue(new Error('[FORBIDDEN] solo OWNER/ADMIN'))
    const { POST } = await import('@/app/api/billing/checkout/route')
    const res = await POST(makeRequest({ workspaceId: 'ws-1', tier: 'PRO' }))
    expect(res.status).toBe(403)
  })

  it('200 con url y sessionId en flujo feliz', async () => {
    requireManagerMock.mockResolvedValue({
      user: { id: 'u-1', email: 'edwin@test.mx' },
      role: 'OWNER',
    })
    findWsMock.mockResolvedValue({ id: 'ws-1', name: 'My WS', slug: 'my-ws' })
    getSubMock.mockResolvedValue({
      tier: 'FREE',
      isActive: true,
      stripeCustomerId: null,
      seats: 1,
    })
    customerMock.mockResolvedValue('cus_test_123')
    checkoutMock.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/sess_x',
      sessionId: 'cs_test_1',
    })

    const { POST } = await import('@/app/api/billing/checkout/route')
    const res = await POST(makeRequest({ workspaceId: 'ws-1', tier: 'PRO' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { url: string; sessionId: string }
    expect(json.url).toContain('checkout.stripe.com')
    expect(json.sessionId).toBe('cs_test_1')
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.checkout_started' }),
    )
  })

  it('503 si Stripe no está configurado', async () => {
    requireManagerMock.mockResolvedValue({
      user: { id: 'u-1', email: 'edwin@test.mx' },
      role: 'OWNER',
    })
    findWsMock.mockResolvedValue({ id: 'ws-1', name: 'My WS', slug: 'my-ws' })
    getSubMock.mockResolvedValue({ tier: 'FREE', isActive: true, stripeCustomerId: null, seats: 1 })
    customerMock.mockRejectedValue(
      new Error('[STRIPE_NOT_CONFIGURED] STRIPE_SECRET_KEY env var requerida'),
    )

    const { POST } = await import('@/app/api/billing/checkout/route')
    const res = await POST(makeRequest({ workspaceId: 'ws-1', tier: 'PRO' }))
    expect(res.status).toBe(503)
  })

  it('500/400 si Stripe Price ID no configurado', async () => {
    requireManagerMock.mockResolvedValue({
      user: { id: 'u-1', email: 'edwin@test.mx' },
      role: 'OWNER',
    })
    findWsMock.mockResolvedValue({ id: 'ws-1', name: 'My WS', slug: 'my-ws' })
    getSubMock.mockResolvedValue({ tier: 'FREE', isActive: true, stripeCustomerId: null, seats: 1 })
    customerMock.mockResolvedValue('cus_test_123')
    checkoutMock.mockRejectedValue(
      new Error('[STRIPE_PRICE_NOT_CONFIGURED] No hay Stripe Price ID para tier PRO'),
    )

    const { POST } = await import('@/app/api/billing/checkout/route')
    const res = await POST(makeRequest({ workspaceId: 'ws-1', tier: 'PRO' }))
    expect(res.status).toBe(503)
    const json = (await res.json()) as { error: { code: string } }
    expect(json.error.code).toBe('STRIPE_PRICE_NOT_CONFIGURED')
  })
})
